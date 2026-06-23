/**
 * 同期コントローラ（Phase 2・Slice 2c）。純エンジン（src/core/sync/engine.ts）に実 I/O を結線し、
 * autosave push を ~30s で coalesce（合体）してクラウドへ送る。ログイン時は全双方向同期を走らせる。
 *
 * ここは React に依存しない（タイマーと navigator 判定は注入される）。結線は src/ui/sync/use-sync.ts。
 * ゲスト（未ログイン・トークン無し）では isEnabled() が false を返し、すべて no-op になる。
 */

import type { ProfileRepository } from '@/core/profile'
import type { Work } from '@/core/schema'
import type { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import type { SyncMetaRepository } from '@/core/storage/syncMetaRepository'
import type { WorkRepository } from '@/core/storage/workRepository'
import type { LoginSyncResult, PullResult, PushPayload, SyncDeps } from '@/core/sync/engine'
import {
  runAutosavePush as engineAutosavePush,
  runLoginSync as engineLoginSync,
} from '@/core/sync/engine'
import { type ManifestEntry, PROFILE_WORK_ID } from '@/core/sync/manifest'
import { type ProfileSyncDeps, pushProfileChange, runProfileSync } from '@/core/sync/profile-sync'

/** バナー表示用の同期フェーズ。 */
export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'paused-offline'
  | 'paused-capacity'
  | 'paused-superseded'

/** push の HTTP 結果（_api/sync.ts の PushResponse と同形）。 */
interface PushResponse {
  status: number
  result: { docHash: string; mediaHash: string; size: number } | null
}

export interface SyncApi {
  getManifest(): Promise<ManifestEntry[]>
  pullWork(workId: string): Promise<PullResult | null>
  pushWork(workId: string, payload: PushPayload): Promise<PushResponse>
  deleteWork(workId: string): Promise<boolean>
}

export interface SyncControllerDeps {
  api: SyncApi
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  syncMetaRepo: SyncMetaRepository
  profileRepo: ProfileRepository
  hashPart(value: unknown): Promise<string>
  genId(): string
  now(): number
  /** ログイン済み（member）かつトークンを取得できる状態か。false ならすべて no-op。 */
  isEnabled(): boolean
  /** オンラインか（既定 navigator.onLine）。オフライン時は push を保留する。 */
  isOnline(): boolean
  /** autosave push の合体間隔（ms）。 */
  debounceMs: number
  /** フェーズ変化の通知（バナー用）。 */
  onStatus?: (phase: SyncPhase) => void
}

export interface SyncController {
  /** ログイン時の全双方向同期。完了後の結果（無効時は null）。 */
  runLoginSync(): Promise<LoginSyncResult | null>
  /** プロフィール（ペンネーム・アバター）変更時の差分 push（pull はしない）。 */
  syncProfile(): Promise<void>
  /** 保存通知。workId を pending に積み、debounce 後に push する。 */
  notifyChanged(workId: string): void
  /** pending を即時 flush（話の切替・タブ非表示・オンライン復帰時など）。 */
  flush(): Promise<void>
  /** 完全削除をリモートへ伝播（トゥームストーン化）。 */
  purge(workId: string): Promise<void>
  /** タイマー破棄（アンマウント・サインアウト時）。 */
  dispose(): void
}

export function createSyncController(deps: SyncControllerDeps): SyncController {
  const { api, repo, snapshotRepo, syncMetaRepo, profileRepo, hashPart, genId, now } = deps

  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false
  // 直近の push で観測したブロック要因（容量超過・別端末）。各オペレーション開始時にクリア。
  let blocked: SyncPhase | null = null

  const emit = (phase: SyncPhase) => deps.onStatus?.(phase)

  const engineDeps: SyncDeps = {
    getManifest: () => api.getManifest(),
    pullWork: (workId) => api.pullWork(workId),
    pushWork: async (workId, payload) => {
      const { status, result } = await api.pushWork(workId, payload)
      if (status === 409) blocked = 'paused-superseded'
      else if (status === 507 || status === 413) blocked = 'paused-capacity'
      return result
    },
    listLocalWorks: async () => {
      const summaries = await repo.listWorks()
      const works = await Promise.all(summaries.map((s) => repo.getWork(s.id)))
      return works.filter((w): w is Work => w !== undefined)
    },
    loadLocalWork: async (workId) => (await repo.getWork(workId)) ?? null,
    saveLocalWork: (work) => repo.saveWork(work),
    trashLocalWork: (workId) => repo.trashWork(workId, now()),
    snapshotLocal: async (work) => {
      await snapshotRepo.append(work, now(), genId())
    },
    getSyncMeta: (workId) => syncMetaRepo.get(workId),
    setSyncMeta: (meta) => syncMetaRepo.set(meta),
    hashPart,
    now,
  }

  // プロフィール同期の I/O。予約 workId `__profile__` で Work と同じ API・暗号化 R2 に相乗りする。
  const profileDeps: ProfileSyncDeps = {
    getRemoteEntry: async () => {
      const entries = await api.getManifest()
      return entries.find((e) => e.workId === PROFILE_WORK_ID) ?? null
    },
    pullProfile: () => api.pullWork(PROFILE_WORK_ID),
    pushProfile: async (payload) => {
      const { status, result } = await api.pushWork(PROFILE_WORK_ID, payload)
      if (status === 409) blocked = 'paused-superseded'
      else if (status === 507 || status === 413) blocked = 'paused-capacity'
      return result
    },
    loadLocalProfile: () => profileRepo.get(),
    saveLocalProfile: (profile) => profileRepo.save(profile),
    getMeta: () => syncMetaRepo.get(PROFILE_WORK_ID),
    setMeta: (meta) => syncMetaRepo.set(meta),
    hashPart,
    now,
  }

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** enabled かつ online を確認し、syncing→（blocked or idle）の状態遷移で run を包む。 */
  async function withPhase<T>(run: () => Promise<T>): Promise<T | null> {
    if (!deps.isEnabled()) return null
    if (!deps.isOnline()) {
      emit('paused-offline')
      return null
    }
    blocked = null
    emit('syncing')
    try {
      return await run()
    } catch {
      return null
    } finally {
      emit(blocked ?? 'idle')
    }
  }

  async function flushPending(): Promise<void> {
    if (flushing || pending.size === 0) return
    if (!deps.isEnabled()) {
      pending.clear() // ゲストでは同期しない。溜め込まず捨てる。
      return
    }
    if (!deps.isOnline()) {
      emit('paused-offline') // 保留したまま、オンライン復帰時に flush() で再送する。
      return
    }
    flushing = true
    const ids = [...pending]
    pending.clear()
    try {
      await withPhase(async () => {
        for (const id of ids) await engineAutosavePush(engineDeps, id)
      })
    } finally {
      flushing = false
    }
  }

  return {
    async runLoginSync() {
      clearTimer()
      pending.clear() // 全双方向同期が pending の push も包含するため、二重送信を防ぐ。
      return withPhase(async () => {
        const res = await engineLoginSync(engineDeps)
        await runProfileSync(profileDeps) // プロフィールも同じ枠で双方向同期する。
        return res
      })
    },

    async syncProfile() {
      await withPhase(() => pushProfileChange(profileDeps))
    },

    notifyChanged(workId) {
      if (!deps.isEnabled()) return
      pending.add(workId)
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void flushPending()
      }, deps.debounceMs)
    },

    async flush() {
      clearTimer()
      await flushPending()
    },

    async purge(workId) {
      pending.delete(workId)
      await syncMetaRepo.delete(workId)
      if (!deps.isEnabled() || !deps.isOnline()) return
      await api.deleteWork(workId)
    },

    dispose() {
      clearTimer()
    },
  }
}
