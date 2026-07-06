/**
 * 同期オーケストレーション（Phase 2）。plan/lww/split の純ロジックを束ね、I/O は
 * すべて注入された関数（deps）で行う。これ自体は React/fetch/crypto/IndexedDB を直接触らない
 * （core 境界準拠・テスト容易）。実 I/O の結線は src/ui/sync/sync-controller.ts。
 */

import type { Work } from '../schema'
import { resolvePush } from './lww'
import type { LocalSyncMeta, ManifestEntry } from './manifest'
import { PROFILE_WORK_ID } from './manifest'
import { planAutosavePush } from './plan'
import { splitWork, type WorkDoc, type WorkMedia } from './split'

/** push の本文（平文 part を含む）。media を null で送ると削除。 */
export interface PushPayload {
  updatedAt: number
  parts: Array<'doc' | 'media'>
  doc?: unknown
  media?: unknown
}

/** push 成功時にサーバが返すハッシュとサイズ。 */
export interface PushResult {
  docHash: string
  mediaHash: string
  size: number
}

/** pull で得る平文 part。 */
export interface PullResult {
  doc: unknown
  media: unknown
  updatedAt: number
}

/** エンジンが必要とする I/O 一式（アダプタが実装を注入する）。 */
export interface SyncDeps {
  getManifest(): Promise<ManifestEntry[]>
  pullWork(workId: string): Promise<PullResult | null>
  pushWork(workId: string, payload: PushPayload): Promise<PushResult | null>
  listLocalWorks(): Promise<Work[]>
  /** ローカルのゴミ箱作品（共有ゴミ箱の同期対象）。id と trashedAt だけでよい。 */
  listLocalTrashed(): Promise<Array<{ workId: string; trashedAt: number }>>
  loadLocalWork(workId: string): Promise<Work | null>
  saveLocalWork(work: Work): Promise<void>
  /** リモート削除を適用：ローカル active をゴミ箱へ（trashedAt はサーバの時刻に揃える）。 */
  trashLocalWork(workId: string, trashedAt: number): Promise<void>
  /** リモートが勝ったゴミ箱復元：ゴミ箱から出して active 内容で保存する。 */
  restoreLocalWork(work: Work): Promise<void>
  /** ローカルのゴミ箱状態をサーバへ伝播（PATCH）。成功で true。 */
  pushTrashState(workId: string, body: { trashed: boolean; updatedAt: number }): Promise<boolean>
  /** 上書き前の敗者保全（スナップショット履歴へ退避）。 */
  snapshotLocal(work: Work): Promise<void>
  getSyncMeta(workId: string): Promise<LocalSyncMeta | null>
  setSyncMeta(meta: LocalSyncMeta): Promise<void>
  /** canonicalize → SHA-256(hex)。クライアント・サーバで同一であること。 */
  hashPart(value: unknown): Promise<string>
  now(): number
}

export interface LoginSyncResult {
  pulled: string[]
  pushed: string[]
  /** リモート削除を適用してローカルをゴミ箱へ送った id。 */
  trashed: string[]
  /** リモートが勝ってローカルのゴミ箱から復元した id（共有ゴミ箱）。 */
  restored: string[]
  /** ローカルのゴミ箱状態をサーバへ伝播した id（共有ゴミ箱）。 */
  trashPropagated: string[]
}

interface Digest {
  doc: WorkDoc
  media: WorkMedia | null
  docHash: string
  mediaHash: string
}

async function digestWork(deps: SyncDeps, work: Work): Promise<Digest> {
  const { doc, media } = splitWork(work)
  const docHash = await deps.hashPart(doc)
  const mediaHash = media === null ? '' : await deps.hashPart(media)
  return { doc, media, docHash, mediaHash }
}

async function pushOne(
  deps: SyncDeps,
  work: Work,
  digest: Digest,
  remote: ManifestEntry | undefined,
): Promise<boolean> {
  const parts = resolvePush(
    { docHash: digest.docHash, mediaHash: digest.mediaHash },
    remote ? { docHash: remote.docHash, mediaHash: remote.mediaHash } : null,
  )
  const partList: Array<'doc' | 'media'> = []
  if (parts.doc) partList.push('doc')
  if (parts.media) partList.push('media')
  if (partList.length === 0) return false

  const res = await deps.pushWork(work.id, {
    updatedAt: work.updatedAt ?? deps.now(),
    parts: partList,
    doc: parts.doc ? digest.doc : undefined,
    media: parts.media ? digest.media : undefined,
  })
  if (!res) return false
  await deps.setSyncMeta({
    workId: work.id,
    docHash: res.docHash,
    mediaHash: res.mediaHash,
    syncedAt: deps.now(),
  })
  return true
}

/**
 * ログイン時のクラウドバックアップ（**一方向 push のみ・自動 pull なし**）。
 *
 * ローカル IndexedDB を常に正本とし、クラウドへはバックアップとして push するだけ。自動 pull で
 * ローカルを上書きしない（ログアウト中の編集喪失・ゴミ箱の復活を構造的に防ぐ）。別端末の変更は
 * 明示的な「取り込み／復元」で取得する。ゴミ箱はローカルのみ（同期しない）。
 *
 * 版履歴（版ごと保持）が入るまでは、**新しいクラウドバックアップを古いローカルで上書きしない**よう
 * `updatedAt` で保護する（古いローカルはスキップ＝クラウドの新しい版を守る）。
 */
export async function runLoginSync(deps: SyncDeps): Promise<LoginSyncResult> {
  // プロフィール（予約 workId）は別パイプライン（runProfileSync）で扱う。作品一覧から除外する。
  const remote = (await deps.getManifest()).filter((e) => e.workId !== PROFILE_WORK_ID)
  const remoteMap = new Map(remote.map((e) => [e.workId, e]))
  const locals = await deps.listLocalWorks()

  const result: LoginSyncResult = {
    pulled: [],
    pushed: [],
    trashed: [],
    restored: [],
    trashPropagated: [],
  }

  for (const work of locals) {
    const r = remoteMap.get(work.id)
    // クラウドの方が新しいバックアップ＝古いローカルで上書きしない（別端末のバックアップを守る）。
    if (r && (work.updatedAt ?? 0) < r.updatedAt) continue
    const digest = await digestWork(deps, work)
    if (await pushOne(deps, work, digest, r)) {
      result.pushed.push(work.id)
    }
  }

  return result
}

/** autosave 時、編集中 1 Work の変わったパートだけを push する（pull はしない）。 */
export async function runAutosavePush(deps: SyncDeps, workId: string): Promise<boolean> {
  const work = await deps.loadLocalWork(workId)
  if (!work) return false

  const digest = await digestWork(deps, work)
  const meta = await deps.getSyncMeta(workId)
  const plan = planAutosavePush(
    { docHash: digest.docHash, mediaHash: digest.mediaHash },
    meta ? { docHash: meta.docHash, mediaHash: meta.mediaHash } : null,
  )
  if (!plan.shouldPush) return false

  const res = await deps.pushWork(workId, {
    updatedAt: work.updatedAt ?? deps.now(),
    parts: plan.parts,
    doc: plan.parts.includes('doc') ? digest.doc : undefined,
    media: plan.parts.includes('media') ? digest.media : undefined,
  })
  if (!res) return false
  await deps.setSyncMeta({
    workId,
    docHash: res.docHash,
    mediaHash: res.mediaHash,
    syncedAt: deps.now(),
  })
  return true
}
