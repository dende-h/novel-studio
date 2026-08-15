import { type Work, WorkSchema } from '@/core/schema'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { IdbStore } from '@/core/storage/idbStore'
import { WorkRepository } from '@/core/storage/workRepository'
import { canonicalWorkJson, sha256Hex } from '@/core/sync/hash'
import { planReconcile } from '@/core/sync/plan'
import { SyncBaseRepository } from '@/core/sync/syncBaseRepository'
import type { ConflictInfo, RemoteWorkMeta } from '@/core/sync/types'
import {
  deleteSyncWork as apiDelete,
  getSyncWork as apiGet,
  getSyncManifest as apiManifest,
  patchSyncWork as apiPatch,
  putSyncWork as apiPut,
} from '@/ui/_api/sync'

/**
 * Work 単位の自動同期（reconcile ループ）。
 *
 * 1 回の reconcile ＝ ①ローカル全作品・ゴミ箱・base（最後に同期した点）を集め
 * ②サーバ manifest と突き合わせて純ロジック（core/sync/plan）で差分計画を立て
 * ③push（CAS 付き）／pull／ゴミ箱伝播／purge 伝播を実行し ④base を更新する。
 *
 * 旧設計（2026-07 廃止）の失敗への対策：
 * - pull がローカルを上書きするのは「ローカルが base から未変更（clean）」の作品だけ。
 *   双方が変わっていたら三方向差分で競合として扱い、敗者を必ず snapshot へ退避してから
 *   LWW で解決し、呼び出し側へ conflicts として報告する（黙った上書きが起きない）。
 * - push は CAS（x-base-hash）付き。サーバ側が進んでいれば 409 で弾かれ、
 *   manifest を取り直して 1 回だけ再 reconcile する（それでも駄目なら次の機会）。
 * - 削除・ゴミ箱は共有ゴミ箱（D-SYNC-TOMBSTONE 改）として伝播し、復活・増殖を防ぐ。
 */

export interface ReconcileSummary {
  pushed: number
  pulled: number
  conflicts: ConflictInfo[]
  /** pull・ゴミ箱移動などでローカルが変わったか（呼び出し側が store.init() で再読込する）。 */
  changedLocal: boolean
}

export interface SyncService {
  /** 1 回の同期。オフライン・未ログイン・非会員（manifest 不可）は null。多重呼び出しは合流する。 */
  reconcile(): Promise<ReconcileSummary | null>
  /**
   * 完了した実行すべての結果を受け取る（内部の追走・再試行を含む）。reconcile() の戻り値だけを
   * 見ると、実行中に合流した呼び出しの後に走る追走の pull・競合が取りこぼされるため、
   * UI の再読込・トーストはこちらで拾う。
   */
  subscribeSummary(listener: (summary: ReconcileSummary) => void): () => void
}

/** テストで差し替える I/O。既定実装は createDefaultSyncService が結線する。 */
export interface SyncDeps {
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  bases: SyncBaseRepository
  manifest(): Promise<RemoteWorkMeta[] | null>
  getWork(
    workId: string,
  ): Promise<{ json: string; updatedAt: number; trashedAt: number; docHash: string } | null>
  putWork(
    workId: string,
    plaintext: string,
    opts: { baseHash: string; updatedAt: number; trashedAt: number },
  ): Promise<
    { ok: true; docHash: string; syncedAt: number } | { ok: false; conflict: RemoteWorkMeta } | null
  >
  patchWork(
    workId: string,
    body: { trashedAt: number; updatedAt: number },
  ): Promise<{ ok: true } | { ok: false; conflict: RemoteWorkMeta } | null>
  deleteWork(workId: string, at: number): Promise<boolean>
  now(): number
  genId(): string
  /**
   * いま執筆画面で開いている作品の id（無ければ null）。開いている作品への pull・ゴミ箱移動・
   * purge はエディタ表示と食い違うため実行を見送り、画面を離れた後の reconcile に委ねる
   * （旧 D-SYNC-TRIGGER「編集中に他端末の変更を引っ張らない」の継承）。
   */
  getOpenWorkId?: () => string | null
}

export function createSyncService(deps: SyncDeps): SyncService {
  let inFlight: Promise<ReconcileSummary | null> | null = null
  let rerunRequested = false

  async function runOnce(depth: number): Promise<ReconcileSummary | null> {
    const remote = await deps.manifest()
    if (remote === null) return null

    const now = deps.now()
    const works = await deps.repo.listWorksFull()
    const trash = await deps.repo.listTrashFull()
    const bases = await deps.bases.list()

    // push 本体と dirty 判定で同一文字列を使う（ハッシュ対象＝送信バイト列）。
    const canon = new Map<string, string>()
    const localWorks = await Promise.all(
      works.map(async (w) => {
        const s = canonicalWorkJson(w)
        canon.set(w.id, s)
        return { workId: w.id, updatedAt: w.updatedAt ?? 0, hash: await sha256Hex(s) }
      }),
    )
    const localTrash = await Promise.all(
      trash.map(async (t) => {
        const s = canonicalWorkJson(t.work)
        canon.set(t.work.id, s)
        return {
          workId: t.work.id,
          updatedAt: t.work.updatedAt ?? 0,
          trashedAt: t.trashedAt,
          hash: await sha256Hex(s),
        }
      }),
    )

    const remoteMap = new Map(remote.map((r) => [r.workId, r]))
    const activeIds = new Set(works.map((w) => w.id))
    const trashById = new Map(trash.map((t) => [t.work.id, t]))
    // 計画時点のローカル内容ハッシュ。pull 実行直前の「その後に編集されていないか」再検証に使う。
    const planHash = new Map([
      ...localWorks.map((w) => [w.workId, w.hash] as const),
      ...localTrash.map((t) => [t.workId, t.hash] as const),
    ])
    const { ops, conflicts } = planReconcile({ now, localWorks, localTrash, bases, remote })
    const conflictIds = new Set(conflicts.map((c) => c.workId))

    const summary: ReconcileSummary = { pushed: 0, pulled: 0, conflicts, changedLocal: false }
    // 開いている作品への破壊的 op を見送った workId（競合の報告からも外す＝未解決のため）。
    const deferredIds = new Set<string>()
    // purge の伝播に失敗した workId（base を消すと次回 pull で復活してしまうので温存する）。
    const failedPurges = new Set<string>()
    let replanNeeded = false
    const openWorkId = deps.getOpenWorkId?.() ?? null

    for (const op of ops) {
      switch (op.op) {
        case 'push': {
          const body = canon.get(op.workId)
          if (body === undefined) break
          const res = await deps.putWork(op.workId, body, {
            baseHash: op.baseHash,
            updatedAt: op.updatedAt,
            trashedAt: op.trashedAt,
          })
          if (res === null) break // オフライン等：base を触らず次の機会に任せる
          if (!res.ok) {
            replanNeeded = true // サーバが進んでいた。再 reconcile で三方向差分に回す
            break
          }
          summary.pushed++
          await deps.bases.set({
            workId: op.workId,
            baseHash: res.docHash,
            remoteUpdatedAt: op.updatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'pullContent': {
          // 執筆画面で開いている作品は上書きしない（エディタの編集状態と食い違うため）。
          // 画面を離れた後の reconcile が改めて計画する。
          if (op.workId === openWorkId) {
            deferredIds.add(op.workId)
            break
          }
          const got = await deps.getWork(op.workId)
          if (got === null) break
          let pulled: Work
          try {
            pulled = WorkSchema.parse(JSON.parse(got.json))
          } catch {
            break // 壊れた/未知形式はローカルを触らない（backup 系と同じ防波堤）
          }
          // ネットワーク往復の間にローカルが編集されていたら上書きしない（黙った消失の防止）。
          // 再計画に回せば、その編集は dirty として三方向差分（競合なら退避つき）に入る。
          const current = await deps.repo.getWork(op.workId)
          if (current) {
            const currentHash = await sha256Hex(canonicalWorkJson(current))
            if (currentHash !== planHash.get(op.workId)) {
              replanNeeded = true
              break
            }
          }
          // 競合の敗者（ローカル版）は上書き前に必ず履歴へ退避する＝丸ごと消失させない。
          if (conflictIds.has(op.workId) && current) {
            await deps.snapshotRepo.append(current, deps.now(), deps.genId())
          }
          await deps.repo.saveWork(pulled)
          if (op.toTrashedAt !== null) {
            await deps.repo.trashWork(op.workId, op.toTrashedAt)
          }
          summary.pulled++
          summary.changedLocal = true
          await deps.bases.set({
            workId: op.workId,
            baseHash: got.docHash,
            remoteUpdatedAt: got.updatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'patchTrash': {
          const res = await deps.patchWork(op.workId, {
            trashedAt: op.trashedAt,
            updatedAt: op.updatedAt,
          })
          if (res === null) break
          if (!res.ok) {
            replanNeeded = true
            break
          }
          const r = remoteMap.get(op.workId)
          if (r) {
            await deps.bases.set({
              workId: op.workId,
              baseHash: r.docHash,
              remoteUpdatedAt: op.updatedAt,
              syncedAt: deps.now(),
            })
          }
          break
        }
        case 'trashLocal': {
          // 開いている作品をゴミ箱へ移すのは見送る（エディタ表示と食い違うため・後の reconcile に委ねる）。
          if (op.workId === openWorkId) {
            deferredIds.add(op.workId)
            break
          }
          // active→trash。既にゴミ箱なら trashedAt の付け替え（復元→退避で実現・repo に専用 API を増やさない）。
          if (!activeIds.has(op.workId)) await deps.repo.restoreWork(op.workId)
          await deps.repo.trashWork(op.workId, op.trashedAt)
          summary.changedLocal = true
          const r = remoteMap.get(op.workId)
          if (r) {
            await deps.bases.set({
              workId: op.workId,
              baseHash: r.docHash,
              remoteUpdatedAt: r.updatedAt,
              syncedAt: deps.now(),
            })
          }
          break
        }
        case 'restoreLocal': {
          await deps.repo.restoreWork(op.workId)
          summary.changedLocal = true
          break
        }
        case 'purgeLocal': {
          // 開いている作品の purge は見送る（後の reconcile に委ねる）。
          if (op.workId === openWorkId) {
            deferredIds.add(op.workId)
            break
          }
          // 他端末の purge（トゥームストーン）の伝播。消える内容は必ず履歴へ退避してから消す。
          const active = await deps.repo.getWork(op.workId)
          const victim = active ?? trashById.get(op.workId)?.work
          if (victim) await deps.snapshotRepo.append(victim, deps.now(), deps.genId())
          await deps.repo.deleteWork(op.workId)
          await deps.repo.purgeTrashedWork(op.workId)
          summary.changedLocal = true
          break
        }
        case 'purgeRemote': {
          // 失敗（オフライン・レート制限・409＝purge 後にリモートが前進）したら base を温存する。
          // ここで base を消すと次の reconcile が「他端末の新規」と誤認して pull し、
          // 消したはずの作品が復活してしまう（旧設計の失敗の再来）ため。
          if (!(await deps.deleteWork(op.workId, op.at))) {
            failedPurges.add(op.workId)
            replanNeeded = true
          }
          break
        }
        case 'adoptBase': {
          await deps.bases.set({
            workId: op.workId,
            baseHash: op.hash,
            remoteUpdatedAt: op.remoteUpdatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'dropBase': {
          if (failedPurges.has(op.workId)) break // purge 伝播に失敗した base は温存（上記）
          await deps.bases.delete(op.workId)
          break
        }
      }
    }

    // 見送った作品（開いている作品への破壊的 op）の競合は未解決なので報告しない。
    summary.conflicts = summary.conflicts.filter((c) => !deferredIds.has(c.workId))

    // CAS で弾かれた・実行中にローカルが動いた作品は、最新 manifest を取り直して
    // 1 回だけ再計画する（三方向差分に入り、勝敗と退避が正しく付く）。連敗したら次のトリガに任せる。
    if (replanNeeded && depth === 0) {
      const again = await runOnce(depth + 1)
      if (again) {
        return {
          pushed: summary.pushed + again.pushed,
          pulled: summary.pulled + again.pulled,
          conflicts: [...summary.conflicts, ...again.conflicts],
          changedLocal: summary.changedLocal || again.changedLocal,
        }
      }
    }
    return summary
  }

  const listeners = new Set<(summary: ReconcileSummary) => void>()

  const service: SyncService = {
    reconcile() {
      // 実行中の呼び出しに合流させ、終了後に 1 回だけ追走する（編集中の連打を潰す）。
      if (inFlight) {
        rerunRequested = true
        return inFlight
      }
      inFlight = runOnce(0)
        .then((summary) => {
          // 追走・再試行の結果も含め、完了した実行はすべて listener に届ける
          // （reconcile() の戻り値だけだと合流後の追走分が取りこぼされる）。
          if (summary) for (const l of listeners) l(summary)
          return summary
        })
        .catch(() => null) // 想定外の失敗も飲み込み、次のトリガで再試行（オフライン耐性と同線）
        .finally(() => {
          inFlight = null
          if (rerunRequested) {
            rerunRequested = false
            void service.reconcile()
          }
        })
      return inFlight
    },
    subscribeSummary(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return service
}

/** 本番用：IndexedDB 上の各リポジトリと `/api/sync` を結線する（会員のときだけ生成すること）。 */
export function createDefaultSyncService(
  getToken: () => Promise<string | null>,
  getOpenWorkId?: () => string | null,
): SyncService {
  const store = new IdbStore('novel-studio')
  return createSyncService({
    repo: new WorkRepository(store),
    snapshotRepo: new SnapshotRepository(store),
    bases: new SyncBaseRepository(store),
    manifest: () => apiManifest(getToken),
    getWork: (id) => apiGet(getToken, id),
    putWork: (id, body, opts) => apiPut(getToken, id, body, opts),
    patchWork: (id, body) => apiPatch(getToken, id, body),
    deleteWork: (id, at) => apiDelete(getToken, id, at),
    now: () => Date.now(),
    genId: () => crypto.randomUUID(),
    getOpenWorkId,
  })
}
