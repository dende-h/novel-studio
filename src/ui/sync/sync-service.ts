import type { DailyActivity } from '@/core/activity'
import { IdeaNoteSchema } from '@/core/idea'
import { PlotSchema } from '@/core/plot'
import { ProfileRepository, ProfileSchema } from '@/core/profile'
import { type Work, WorkSchema } from '@/core/schema'
import { createSnapshot } from '@/core/snapshot'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { ActivityRepository } from '@/core/storage/activityRepository'
import { IdbStore } from '@/core/storage/idbStore'
import { IdeaRepository } from '@/core/storage/ideaRepository'
import { PlotRepository } from '@/core/storage/plotRepository'
import { StructureRepository } from '@/core/storage/structureRepository'
import { WorkRepository } from '@/core/storage/workRepository'
import { StructureSchema } from '@/core/structure'
import { type ActivityDay, mergeActivity, toActivityDay } from '@/core/sync/activityMerge'
import { canonicalJson, canonicalWorkJson, sha256Hex } from '@/core/sync/hash'
import { planReconcile } from '@/core/sync/plan'
import { SyncBaseRepository } from '@/core/sync/syncBaseRepository'
import {
  type SyncLostEntry,
  type SyncLostReason,
  SyncLostRepository,
} from '@/core/sync/syncLostRepository'
import type { ConflictInfo, RemoteWorkMeta } from '@/core/sync/types'
import {
  deleteSyncWork as apiDelete,
  getSyncWork as apiGet,
  getSyncVersion as apiGetVersion,
  getSyncManifest as apiManifest,
  patchSyncWork as apiPatch,
  postSyncActivity as apiPostActivity,
  putSyncWork as apiPut,
} from '@/ui/_api/sync'
import { isSyncSuspended, syncEpoch } from '@/ui/sync/sync-gate'

/**
 * アイテム単位の自動同期（reconcile ループ）。対象＝Work＋構造レイヤー＋ネタ帳（CAS 同期）と
 * 執筆の記録（D1 max マージ・D-SYNC2-ACTIVITY-DB）。
 *
 * 1 回の reconcile ＝ ①ローカル全アイテム・ゴミ箱・base（最後に同期した点）を集め
 * ②サーバ manifest と突き合わせて純ロジック（core/sync/plan）で差分計画を立て
 * ③push（CAS 付き）／pull／ゴミ箱伝播／purge 伝播を実行し ④base を更新し
 * ⑤執筆の記録を max マージで往復する。
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
   * 実際に同期（reconcile）が走っている間だけ true を流す。ヘッダーの「同期中…」表示用。
   * 軽量 poll（世代チェックだけで終わる往復）は走行に数えない＝5 秒ごとに点滅させない。
   */
  subscribeRunning(listener: (running: boolean) => void): () => void
  /**
   * 軽量ポーリング用：サーバの同期世代（/api/sync/version）を確かめ、前回から動いていた
   * ときだけ本同期を走らせる。変化なしなら往復 1 回の超軽量 GET で終わる＝~15 秒間隔で
   * 呼んでも安く、受け側のラグを縮められる。判定不能（オフライン等）は null。
   */
  poll(): Promise<ReconcileSummary | null>
  /**
   * 完了した実行すべての結果を受け取る（内部の追走・再試行を含む）。reconcile() の戻り値だけを
   * 見ると、実行中に合流した呼び出しの後に走る追走の pull・競合が取りこぼされるため、
   * UI の再読込・トーストはこちらで拾う。
   */
  subscribeSummary(listener: (summary: ReconcileSummary) => void): () => void
}

/**
 * 同期 id の種別。Work は素の id、構造・ネタ帳・プロフィール・プロットは種別プレフィックス付き id
 * （`structure:<id>` / `idea:<id>` / `profile:me` / `plot:<id>`）で同じ D1 `works` テーブル・API に
 * 相乗りする（D-SYNC2-ITEMS・サーバ無改修）。
 */
type ItemKind = 'work' | 'structure' | 'idea' | 'profile' | 'plot'

/** プロフィールは端末に 1 件だけの singleton（決定的 id）。 */
const PROFILE_SYNC_ID = 'profile:me'

const kindOf = (syncId: string): ItemKind =>
  syncId.startsWith('structure:')
    ? 'structure'
    : syncId.startsWith('idea:')
      ? 'idea'
      : syncId.startsWith('profile:')
        ? 'profile'
        : syncId.startsWith('plot:')
          ? 'plot'
          : 'work'

const rawIdOf = (syncId: string): string => syncId.replace(/^(?:structure|idea|profile|plot):/, '')

/** ネタ帳の 1 行目を退避一覧の見出しに使う（長文は切り詰める）。 */
const ideaTitle = (text: string | undefined): string | undefined => {
  const head = text?.split('\n', 1)[0]?.trim()
  if (!head) return undefined
  return head.length > 24 ? `${head.slice(0, 24)}…` : head
}

/** 同じ作品の競合は 1 件に畳む（1 回目と再計画で二重に数えない）。 */
const dedupeConflicts = (conflicts: ConflictInfo[]): ConflictInfo[] => [
  ...new Map(conflicts.map((c) => [c.workId, c])).values(),
]

/** テストで差し替える I/O。既定実装は createDefaultSyncService が結線する。 */
export interface SyncDeps {
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  structures: StructureRepository
  ideas: IdeaRepository
  profile: ProfileRepository
  plots: PlotRepository
  bases: SyncBaseRepository
  /**
   * 競合の敗者・purge 直前の内容の退避先（`synclost:<syncId>`・1 アイテム 1 世代・件数上限つき）。
   * 作品の競合は履歴（snapshot）が内容を持つので記録だけを残し、履歴を開けなくなる削除の伝播と、
   * 履歴を持たない構造・プロット・ネタ帳・プロフィールは JSON 本体も残す。
   * UI（データ管理 →「同期で退避した版」）がこの一覧を見せる。
   */
  saveLost(entry: SyncLostEntry): Promise<void>
  /**
   * 全置換（復元・AI の変更の取り込み）との排他。世代が変わった／保留中の間は、
   * 取り込み前の前提で書き戻さない（base 書き戻しによる purgeRemote 誤爆の防止）。
   * 省略時は常に「変化なし・保留なし」＝テストの既定挙動。
   */
  epoch?: () => number
  suspended?: () => boolean
  /** 執筆の記録の同期（D1 max マージ）。全日分を送り、マージ済み全量を受け取る。失敗は null。 */
  postActivity(days: ActivityDay[]): Promise<ActivityDay[] | null>
  /** 執筆の記録のローカル一覧・全置換（マージ結果の反映先）。 */
  listActivity(): Promise<DailyActivity[]>
  replaceActivity(days: DailyActivity[]): Promise<void>
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
  /** サーバの同期世代（poll 用の軽量チェック）。失敗は null。 */
  getVersion(): Promise<{ works: number; activity: number } | null>
  now(): number
  genId(): string
  /**
   * いま執筆画面で開いている作品の状態（無ければ null）。
   * - pull：dirty（下書きに未保存の編集がある）の間だけ見送る。それ以外は開いたまま反映し、
   *   呼び出し側（Root）が store.refreshOpenWork() でエディタ状態を追随させる
   *   （＝図鑑・本文の変更もページ遷移なしで届く）。
   * - trashLocal / purgeLocal：開いている間は常に見送る（作品が editor の下から消えるのは
   *   破壊的すぎるため。画面を離れた後の reconcile に委ねる）。
   */
  getOpenWork?: () => { id: string; dirty: boolean } | null
}

export function createSyncService(deps: SyncDeps): SyncService {
  let inFlight: Promise<ReconcileSummary | null> | null = null
  let rerunRequested = false
  // 執筆の記録の送信スキップ判定：最後に送信した内容の署名と「リモート側が動いた」印。
  let lastActivitySig = ''
  let activityRemoteDirty = true

  async function runOnce(depth: number): Promise<ReconcileSummary | null> {
    // 全置換（復元・AI の変更の取り込み）の最中は走り出さない。
    if (deps.suspended?.()) return null
    // この実行が握る世代。全置換が始まると進むので、以後の書き込みをすべて止める
    // （base を書き戻して purgeRemote を誤爆させない・取り込み前の本文で push しない）。
    const epoch0 = deps.epoch?.() ?? 0
    const stale = () => (deps.epoch?.() ?? 0) !== epoch0 || (deps.suspended?.() ?? false)

    const remote = await deps.manifest()
    if (remote === null) return null

    const now = deps.now()
    const works = await deps.repo.listWorksFull()
    const trash = await deps.repo.listTrashFull()
    const bases = await deps.bases.list()

    // push 本体と dirty 判定で同一文字列を使う（ハッシュ対象＝送信バイト列）。
    // 直列化（スキーマ検証）に失敗したレコードは、この回の同期から**完全に外す**（masked）。
    // 1 件の壊れたレコードで reconcile 全体が死ぬと「すべて同期されない」になり、
    // 逆に「ローカル欠落」として扱うと誤って purgeRemote が走るため、外して素通しする。
    const canon = new Map<string, string>()
    const maskedIds = new Set<string>()
    const localWorks: Array<{ workId: string; updatedAt: number; hash: string }> = []
    for (const w of works) {
      try {
        const s = canonicalWorkJson(w)
        canon.set(w.id, s)
        localWorks.push({ workId: w.id, updatedAt: w.updatedAt ?? 0, hash: await sha256Hex(s) })
      } catch {
        maskedIds.add(w.id)
      }
    }
    const localTrash: Array<{
      workId: string
      updatedAt: number
      trashedAt: number
      hash: string
    }> = []
    for (const t of trash) {
      try {
        const s = canonicalWorkJson(t.work)
        canon.set(t.work.id, s)
        localTrash.push({
          workId: t.work.id,
          updatedAt: t.work.updatedAt ?? 0,
          trashedAt: t.trashedAt,
          hash: await sha256Hex(s),
        })
      } catch {
        maskedIds.add(t.work.id)
      }
    }

    // 構造レイヤー・ネタ帳も同じ CAS 同期に載せる（種別プレフィックス付き id・D-SYNC2-ITEMS）。
    // ゴミ箱概念が無いので localTrash には入れず、削除はトゥームストーン直行になる。
    const structures = await deps.structures.list()
    const ideaNotes = await deps.ideas.list()
    const localItems: Array<{ workId: string; updatedAt: number; hash: string }> = []
    for (const s of structures) {
      const syncId = `structure:${s.id}`
      try {
        const str = canonicalJson(StructureSchema, s)
        canon.set(syncId, str)
        localItems.push({ workId: syncId, updatedAt: s.updatedAt, hash: await sha256Hex(str) })
      } catch {
        maskedIds.add(syncId)
      }
    }
    for (const n of ideaNotes) {
      const syncId = `idea:${n.id}`
      try {
        const str = canonicalJson(IdeaNoteSchema, n)
        canon.set(syncId, str)
        localItems.push({ workId: syncId, updatedAt: n.updatedAt, hash: await sha256Hex(str) })
      } catch {
        maskedIds.add(syncId)
      }
    }
    // プロット（幕×ビート）も構造レイヤーと同じ流儀で相乗りする。
    const plotList = await deps.plots.list()
    for (const p of plotList) {
      const syncId = `plot:${p.id}`
      try {
        const str = canonicalJson(PlotSchema, p)
        canon.set(syncId, str)
        localItems.push({ workId: syncId, updatedAt: p.updatedAt, hash: await sha256Hex(str) })
      } catch {
        maskedIds.add(syncId)
      }
    }
    // プロフィール（ペンネーム・アバター）も 1 レコードとして相乗りする。
    // updatedAt が無い＝一度も設定していない端末は push しない（新端末では remote から
    // 普通に pull される。ローカル欠落と誤認した purgeRemote も起きない：プロフィールは
    // 一度設定すると空には戻らないため、base があるのに local が無い状況が生じない）。
    const profileRecord = await deps.profile.get()
    if (profileRecord.updatedAt != null) {
      try {
        const str = canonicalJson(ProfileSchema, profileRecord)
        canon.set(PROFILE_SYNC_ID, str)
        localItems.push({
          workId: PROFILE_SYNC_ID,
          updatedAt: profileRecord.updatedAt,
          hash: await sha256Hex(str),
        })
      } catch {
        maskedIds.add(PROFILE_SYNC_ID)
      }
    }

    const remoteMap = new Map(remote.map((r) => [r.workId, r]))
    const activeIds = new Set(works.map((w) => w.id))
    const trashById = new Map(trash.map((t) => [t.work.id, t]))
    // 計画時点のローカル内容ハッシュ。pull 実行直前の「その後に編集されていないか」再検証に使う。
    const planHash = new Map([
      ...localWorks.map((w) => [w.workId, w.hash] as const),
      ...localTrash.map((t) => [t.workId, t.hash] as const),
      ...localItems.map((i) => [i.workId, i.hash] as const),
    ])
    const { ops, conflicts } = planReconcile({
      now,
      localWorks: [...localWorks, ...localItems],
      localTrash,
      // masked（壊れたレコード）の base/remote も外し、当該 id をこの回の同期から完全に消す
      // （残すと「ローカル欠落」と誤認して purgeRemote が走る）。
      bases: bases.filter((b) => !maskedIds.has(b.workId)),
      remote: remote.filter((r) => !maskedIds.has(r.workId)),
    })
    const conflictIds = new Set(conflicts.map((c) => c.workId))
    const conflictById = new Map(conflicts.map((c) => [c.workId, c]))

    const summary: ReconcileSummary = { pushed: 0, pulled: 0, conflicts: [], changedLocal: false }
    // 実際に決着した競合だけを積む。計画したが実行できなかったもの（オフラインで pull できない・
    // 往復中に編集されて再計画へ回した・開いている作品で見送った）は**まだ競合していない**ので
    // 報告しない：ここを計画ベースにしていたため、何も起きていないのに通知が出ていた。
    const resolved: ConflictInfo[] = []
    const markResolved = (workId: string) => {
      const c = conflictById.get(workId)
      if (c) resolved.push(c)
    }
    // purge の伝播に失敗した workId（base を消すと次回 pull で復活してしまうので温存する）。
    const failedPurges = new Set<string>()
    let replanNeeded = false
    // op 実行のたびに問い直す：reconcile 開始後（ネットワーク往復中）にユーザーが
    // 執筆画面でその作品を開いた場合も、破壊的 op を確実に見送るため。
    const openWork = () => deps.getOpenWork?.() ?? null
    const isOpenWork = (workId: string) => openWork()?.id === workId
    const isOpenWorkDirty = (workId: string) => {
      const o = openWork()
      return o !== null && o.id === workId && o.dirty
    }

    // base の書き込みは stale チェックの後ろに通す。全置換（復元・取り込み）が base を
    // 全消しした**後**にここが書き戻すと、次の reconcile が「base はあるのにローカルに無い」＝
    // 削除済みと誤認して purgeRemote を出し、全端末から作品が消える（事故の芯）。
    const setBase = async (base: {
      workId: string
      baseHash: string
      remoteUpdatedAt: number
      syncedAt: number
    }) => {
      if (stale()) return
      await deps.bases.set(base)
    }
    /**
     * 消える／置き換わる直前の内容を退避の一覧へ記録する。
     * json を渡さないのは作品の競合だけ（内容は履歴が持ち、一覧は履歴への道しるべになる）。
     */
    const recordLost = async (
      syncId: string,
      reason: SyncLostReason,
      title: string | undefined,
      json?: string,
    ) => {
      await deps.saveLost({
        syncId,
        at: deps.now(),
        kind: kindOf(syncId),
        reason,
        title,
        json,
      })
    }

    for (const op of ops) {
      // 全置換が始まったら以降の op は実行しない（取り込み前の前提での書き込みを止める）。
      if (stale()) break
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
          // 競合でこちら（ローカル）が勝った＝サーバ側の版が置き換わった。決着として記録する。
          markResolved(op.workId)
          await setBase({
            workId: op.workId,
            baseHash: res.docHash,
            remoteUpdatedAt: op.updatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'pullContent': {
          const kind = kindOf(op.workId)
          // 開いている作品でも、下書きに未保存の編集が無ければ pull を適用する
          // （適用後は Root が store.refreshOpenWork() でエディタ状態を追随させる）。
          // 未保存編集の最中だけ見送り、自動保存で確定した後の reconcile に委ねる。
          if (kind === 'work' && isOpenWorkDirty(op.workId)) {
            break
          }
          const got = await deps.getWork(op.workId)
          if (got === null) break
          // 往復の間に全置換が走っていたら、取り込み後のローカルを古い内容で上書きしない。
          if (stale()) break

          if (kind === 'work') {
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
            // 履歴に入れるだけだと「どこへ退避したのか」が分からないので、退避の一覧にも記録する。
            if (conflictIds.has(op.workId) && current) {
              await deps.snapshotRepo.append(current, deps.now(), deps.genId(), 'sync')
              await recordLost(op.workId, 'conflict', current.title)
            }
            await deps.repo.saveWork(pulled)
            if (op.toTrashedAt !== null) {
              await deps.repo.trashWork(op.workId, op.toTrashedAt)
            }
          } else {
            // 構造・ネタ帳：スキーマ検証 → 開いている作品の構造は見送り → 直前再検証 →
            // 敗者を synclost へ退避 → 素通し put（updatedAt を刻印しない）。
            const rawId = rawIdOf(op.workId)
            let currentJson: string | undefined
            try {
              if (kind === 'structure') {
                // 開いている作品の構造でも pull は適用する：構造ビューは自前 state で表示して
                // おり IDB 上書きと衝突しない。見送ると /write 内の構造画面で待つ端末が
                // 永遠に受信できない（stg で実発生）。
                const pulled = StructureSchema.parse(JSON.parse(got.json))
                const cur = await deps.structures.get(rawId)
                currentJson = cur ? canonicalJson(StructureSchema, cur) : undefined
                if (currentJson !== undefined) {
                  const currentHash = await sha256Hex(currentJson)
                  if (currentHash !== planHash.get(op.workId)) {
                    replanNeeded = true
                    break
                  }
                  if (conflictIds.has(op.workId)) {
                    await recordLost(op.workId, 'conflict', cur?.title, currentJson)
                  }
                }
                await deps.structures.put(pulled)
              } else if (kind === 'idea') {
                const pulled = IdeaNoteSchema.parse(JSON.parse(got.json))
                const cur = await deps.ideas.get(rawId)
                currentJson = cur ? canonicalJson(IdeaNoteSchema, cur) : undefined
                if (currentJson !== undefined) {
                  const currentHash = await sha256Hex(currentJson)
                  if (currentHash !== planHash.get(op.workId)) {
                    replanNeeded = true
                    break
                  }
                  if (conflictIds.has(op.workId)) {
                    await recordLost(op.workId, 'conflict', ideaTitle(cur?.text), currentJson)
                  }
                }
                await deps.ideas.put(pulled)
              } else if (kind === 'plot') {
                // プロットも構造と同じく開いている作品でも適用する：プロットビューは自前 state で
                // 表示しており IDB 上書きと衝突しない（sync-applied 通知で再読込する）。
                const pulled = PlotSchema.parse(JSON.parse(got.json))
                const cur = await deps.plots.get(rawId)
                currentJson = cur ? canonicalJson(PlotSchema, cur) : undefined
                if (currentJson !== undefined) {
                  const currentHash = await sha256Hex(currentJson)
                  if (currentHash !== planHash.get(op.workId)) {
                    replanNeeded = true
                    break
                  }
                  if (conflictIds.has(op.workId)) {
                    await recordLost(op.workId, 'conflict', cur?.title, currentJson)
                  }
                }
                await deps.plots.put(pulled)
              } else {
                // プロフィール：競合の敗者は synclost へ退避してから LWW 勝者を採用する。
                const pulled = ProfileSchema.parse(JSON.parse(got.json))
                const cur = await deps.profile.get()
                if (cur.updatedAt != null) {
                  currentJson = canonicalJson(ProfileSchema, cur)
                  const currentHash = await sha256Hex(currentJson)
                  if (currentHash !== planHash.get(op.workId)) {
                    replanNeeded = true
                    break
                  }
                  if (conflictIds.has(op.workId)) {
                    await recordLost(op.workId, 'conflict', 'プロフィール', currentJson)
                  }
                }
                await deps.profile.save(pulled)
              }
            } catch {
              break // 壊れた/未知形式はローカルを触らない
            }
          }
          summary.pulled++
          summary.changedLocal = true
          // 競合でリモートが勝った＝ローカル版を退避してから置き換えた。決着として記録する。
          markResolved(op.workId)
          await setBase({
            workId: op.workId,
            baseHash: got.docHash,
            remoteUpdatedAt: got.updatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'patchTrash': {
          if (kindOf(op.workId) !== 'work') break // ゴミ箱状態を持つのは Work のみ（防御）
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
            await setBase({
              workId: op.workId,
              baseHash: r.docHash,
              remoteUpdatedAt: op.updatedAt,
              syncedAt: deps.now(),
            })
          }
          break
        }
        case 'trashLocal': {
          if (kindOf(op.workId) !== 'work') break // ゴミ箱状態を持つのは Work のみ（防御）
          // 開いている作品をゴミ箱へ移すのは見送る（エディタ表示と食い違うため・後の reconcile に委ねる）。
          if (isOpenWork(op.workId)) {
            break
          }
          // active→trash。既にゴミ箱なら trashedAt の付け替え（復元→退避で実現・repo に専用 API を増やさない）。
          if (!activeIds.has(op.workId)) await deps.repo.restoreWork(op.workId)
          await deps.repo.trashWork(op.workId, op.trashedAt)
          summary.changedLocal = true
          // リモートのゴミ箱移動に追随した＝ローカルの編集が引っ込んだ。決着として記録する。
          markResolved(op.workId)
          const r = remoteMap.get(op.workId)
          if (r) {
            await setBase({
              workId: op.workId,
              baseHash: r.docHash,
              remoteUpdatedAt: r.updatedAt,
              syncedAt: deps.now(),
            })
          }
          break
        }
        case 'restoreLocal': {
          if (kindOf(op.workId) !== 'work') break // ゴミ箱状態を持つのは Work のみ（防御）
          await deps.repo.restoreWork(op.workId)
          summary.changedLocal = true
          break
        }
        case 'purgeLocal': {
          const kind = kindOf(op.workId)
          if (kind === 'work') {
            // 開いている作品の purge は見送る（後の reconcile に委ねる）。
            if (isOpenWork(op.workId)) {
              break
            }
            // 他端末の purge（トゥームストーン）の伝播。消える内容は退避してから消す。
            // 退避先は履歴ではなく退避の一覧：作品が消えると履歴（`snap:<workId>`）を開く画面が
            // 無くなり、本人に見えないまま端末に溜まり続けるため（editorStore の purge と同じ考え）。
            // 一覧なら件数上限つきで残り、ファイルへ書き出して取り戻せる。画像は履歴と同じく外す。
            const active = await deps.repo.getWork(op.workId)
            const victim = active ?? trashById.get(op.workId)?.work
            if (victim) {
              const slim = createSnapshot(victim, deps.now(), op.workId).work
              await recordLost(op.workId, 'remoteDelete', victim.title, canonicalWorkJson(slim))
            }
            await deps.repo.deleteWork(op.workId)
            await deps.repo.purgeTrashedWork(op.workId)
            await deps.snapshotRepo.clear(op.workId) // 開く画面の無い履歴を残さない
          } else if (kind === 'structure') {
            const cur = await deps.structures.get(rawIdOf(op.workId))
            // snapshot 機構が無いので synclost へ退避してから消す（黙って消えない）。
            if (cur) {
              await recordLost(
                op.workId,
                'remoteDelete',
                cur.title,
                canonicalJson(StructureSchema, cur),
              )
            }
            await deps.structures.remove(rawIdOf(op.workId))
          } else if (kind === 'idea') {
            const cur = await deps.ideas.get(rawIdOf(op.workId))
            if (cur) {
              await recordLost(
                op.workId,
                'remoteDelete',
                ideaTitle(cur.text),
                canonicalJson(IdeaNoteSchema, cur),
              )
            }
            await deps.ideas.remove(rawIdOf(op.workId))
          } else if (kind === 'plot') {
            const cur = await deps.plots.get(rawIdOf(op.workId))
            if (cur) {
              await recordLost(op.workId, 'remoteDelete', cur.title, canonicalJson(PlotSchema, cur))
            }
            await deps.plots.remove(rawIdOf(op.workId))
          } else {
            break // プロフィールはローカルから消さない（tombstone が来ても保持＝防御）
          }
          summary.changedLocal = true
          // 未同期の編集を消した場合は plan が競合として記録している。決着として報告する。
          markResolved(op.workId)
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
          await setBase({
            workId: op.workId,
            baseHash: op.hash,
            remoteUpdatedAt: op.remoteUpdatedAt,
            syncedAt: deps.now(),
          })
          break
        }
        case 'dropBase': {
          if (failedPurges.has(op.workId)) break // purge 伝播に失敗した base は温存（上記）
          if (stale()) break // 全置換の base 全消しの後に書き戻さない（setBase と同じ理由）
          await deps.bases.delete(op.workId)
          break
        }
      }
    }

    // 執筆の記録（activity）は加算的データなので、CAS ではなく D1 max マージで同期する
    // （D-SYNC2-ACTIVITY-DB）。往復中のローカル増分を守るため、応答は**現在の**ローカルと
    // もう一度 max マージしてから書き戻す（max は単調なので二重適用しても安全）。
    // ローカルが前回送信から不変で、リモート世代（poll の activity 版）も動いていなければ
    // 送らない：coalesce 2.5 秒化で reconcile 頻度が上がるぶん、変更系リクエストを削って
    // レート制限（60 req/min）の余裕を保つ。再計画（depth>0）では走らせない。
    if (depth === 0 && !stale()) {
      const localDays = await deps.listActivity()
      const sig = JSON.stringify(localDays.map(toActivityDay))
      if (sig !== lastActivitySig || activityRemoteDirty) {
        const res = await deps.postActivity(localDays.map(toActivityDay))
        if (res) {
          const fresh = await deps.listActivity()
          const { merged, changed } = mergeActivity(fresh, res)
          // 表示は各画面がマウント時に読み直すため、changedLocal（store.init）は立てない。
          if (changed) await deps.replaceActivity(merged)
          lastActivitySig = JSON.stringify(merged.map(toActivityDay))
          activityRemoteDirty = false
        }
      }
    }

    // 決着した競合だけを報告する（見送り・オフライン・再計画へ回したものは未決着なので出さない）。
    summary.conflicts = resolved

    // 全置換に追い越された実行の結果は使わない（取り込み後の画面を古い前提で書き換えない）。
    if (stale()) return null

    // CAS で弾かれた・実行中にローカルが動いた作品は、最新 manifest を取り直して
    // 1 回だけ再計画する（三方向差分に入り、勝敗と退避が正しく付く）。連敗したら次のトリガに任せる。
    if (replanNeeded && depth === 0) {
      const again = await runOnce(depth + 1)
      if (again) {
        return {
          pushed: summary.pushed + again.pushed,
          pulled: summary.pulled + again.pulled,
          // 同じ作品が 1 回目と再計画の両方に出たら 1 件に畳む（同じ競合を二重に数えない）。
          conflicts: dedupeConflicts([...summary.conflicts, ...again.conflicts]),
          changedLocal: summary.changedLocal || again.changedLocal,
        }
      }
    }
    return summary
  }

  const listeners = new Set<(summary: ReconcileSummary) => void>()
  const runningListeners = new Set<(running: boolean) => void>()
  const setRunning = (running: boolean) => {
    for (const l of runningListeners) l(running)
  }

  // poll が最後に見たサーバ世代。同じなら本同期を省略する（reconcile 後は自分の push で
  // 世代が進むため、取り直して記録し、無限に自分の変更へ反応するのを防ぐ）。
  let lastSeenVersion: { works: number; activity: number } | null = null

  const service: SyncService = {
    async poll() {
      const v = await deps.getVersion()
      if (v === null) return null
      if (
        lastSeenVersion &&
        v.works === lastSeenVersion.works &&
        v.activity === lastSeenVersion.activity
      ) {
        return { pushed: 0, pulled: 0, conflicts: [], changedLocal: false }
      }
      // 別端末が執筆の記録を進めた＝次の reconcile ではローカル不変でも送受信して取り込む。
      if (lastSeenVersion && v.activity !== lastSeenVersion.activity) activityRemoteDirty = true
      const summary = await service.reconcile()
      // 失敗（null）時に世代を記録すると、この世代ぶんの変更を以後永遠にスキップしてしまう。
      if (summary !== null) lastSeenVersion = (await deps.getVersion()) ?? v
      return summary
    },
    reconcile() {
      // 実行中の呼び出しに合流させ、終了後に 1 回だけ追走する（編集中の連打を潰す）。
      if (inFlight) {
        rerunRequested = true
        return inFlight
      }
      setRunning(true) // ヘッダーの「同期中…」を灯す（消すのは finally＝追走も含めて必ず消える）
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
          setRunning(false)
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
    subscribeRunning(listener) {
      runningListeners.add(listener)
      return () => {
        runningListeners.delete(listener)
      }
    },
  }
  return service
}

/** 本番用：IndexedDB 上の各リポジトリと `/api/sync` を結線する（会員のときだけ生成すること）。 */
export function createDefaultSyncService(
  getToken: () => Promise<string | null>,
  getOpenWork?: () => { id: string; dirty: boolean } | null,
): SyncService {
  const store = new IdbStore('novel-studio')
  const activityRepo = new ActivityRepository(store)
  return createSyncService({
    repo: new WorkRepository(store),
    snapshotRepo: new SnapshotRepository(store),
    structures: new StructureRepository(store),
    ideas: new IdeaRepository(store),
    profile: new ProfileRepository(store),
    plots: new PlotRepository(store),
    bases: new SyncBaseRepository(store),
    // 競合の敗者・purge 直前の内容の 1 世代退避（synclost:<syncId>・件数上限つき押し出し）。
    saveLost: (entry) => new SyncLostRepository(store).save(entry),
    // 全置換（復元・AI の変更の取り込み）との排他（sync-gate）。
    epoch: syncEpoch,
    suspended: isSyncSuspended,
    postActivity: (days) => apiPostActivity(getToken, days),
    listActivity: () => activityRepo.list(),
    replaceActivity: (days) => activityRepo.replaceAll(days),
    manifest: () => apiManifest(getToken),
    getWork: (id) => apiGet(getToken, id),
    putWork: (id, body, opts) => apiPut(getToken, id, body, opts),
    patchWork: (id, body) => apiPatch(getToken, id, body),
    deleteWork: (id, at) => apiDelete(getToken, id, at),
    getVersion: () => apiGetVersion(getToken),
    now: () => Date.now(),
    genId: () => crypto.randomUUID(),
    getOpenWork,
  })
}
