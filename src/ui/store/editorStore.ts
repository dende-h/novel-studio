import { blocksToNotation } from '../../core/exporter/blocksToNotation'
import { renameEntry, resolveRef } from '../../core/glossary'
import { DIALOG_VERSION } from '../../core/glossary/dialog'
import { applyGlossaryFieldPatch, type GlossaryFieldPatch } from '../../core/glossary/patch'
import { parseEpisodeBody } from '../../core/parser/parseNotation'
import { reconcileBlockIds } from '../../core/parser/reconcileBlockIds'
import type { Profile, ProfileRepository } from '../../core/profile'
import {
  type DialogAnswer,
  type Episode,
  type GlossaryEntry,
  type Work,
  type WorkPlatform,
  WorkSchema,
} from '../../core/schema'
import {
  planReplacement,
  type SearchMatch,
  type SearchSource,
  searchWork,
} from '../../core/search/workSearch'
import type { Snapshot } from '../../core/snapshot'
import type { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { countWorkChars } from '../../core/stats'
import type { ActivityRepository } from '../../core/storage/activityRepository'
import { withWorkMutationLock } from '../../core/storage/workMutationLock'
import type { TrashSummary, WorkRepository, WorkSummary } from '../../core/storage/workRepository'

/**
 * 執筆エディタの自前最小ストア（useSyncExternalStore 用）。
 * - draft = 現在話の生記法テキスト。保存時に parseEpisodeBody で正本 blocks へ。
 * - 話を開く時は blocksToNotation でロスレスに記法テキストへ戻す（@参照 [[名前]] を含む）。
 * - 状態は immutable に差し替え、getSnapshot は同一状態で同一参照（再描画安定）。
 * 状態ロジックは React 非依存に保ち、Container が subscribe/getSnapshot を橋渡しする。
 */

export type SaveStatus = 'idle' | 'saving' | 'saved'

export interface EditorState {
  workOperation: 'idle' | 'replacing' | 'navigating'
  workList: WorkSummary[]
  work: Work | null
  currentEpisodeId: string | null
  draft: string
  dirty: boolean
  status: SaveStatus
  /** 現在の作品のスナップショット履歴（新しい順） */
  snapshots: Snapshot[]
  /** ゴミ箱の作品一覧（退避時刻つき・新しい順） */
  trashList: TrashSummary[]
  /** 作者プロフィール（ペンネーム・アバター）。未設定なら空オブジェクト。 */
  profile: Profile
  /**
   * いまのペンネームが属するアカウント（Clerk userId）。**`Profile` とは別に持つ**
   * ＝端末間で同期もバックアップもしない印（`src/core/profile/index.ts` の `profile-account`）。
   */
  profileAccountId: string | undefined
}

export interface EditorStore {
  getSearchSources(): SearchSource[]
  replaceWorkMatches(input: {
    workId: string
    sources: readonly SearchSource[]
    query: string
    replacement: string
    target: SearchMatch | 'all'
  }): Promise<{ count: number; committed: boolean; warning?: string }>
  navigateWorkMatch(input: {
    workId: string
    sources: readonly SearchSource[]
    query: string
    match: SearchMatch
  }): Promise<{ start: number; end: number }>
  getSnapshot(): EditorState
  subscribe(listener: () => void): () => void
  init(): Promise<void>
  createWork(title: string, format?: Work['format']): Promise<void>
  openWork(id: string): Promise<void>
  /**
   * 開いている作品を IndexedDB から読み直してメモリ状態を追随させる（同期の pull 反映用）。
   * 下書きに未保存の編集があるとき・内容が変わっていないときは何もしない。
   */
  refreshOpenWork(): Promise<void>
  createEpisode(title: string): Promise<void>
  openEpisode(id: string): void
  setDraft(text: string): void
  save(): Promise<void>
  /** 履歴の版を現在話の下書きへ復元する（保存はユーザー操作に委ねる＝非破壊） */
  restoreSnapshot(snapshotId: string): void
  /** 作品をゴミ箱へ移す（30日後に自動削除）。履歴は復元のため保持。開いている作品なら状態をリセット。 */
  trashWork(id: string): Promise<void>
  /** ゴミ箱から作品を復元する（active へ戻す）。 */
  restoreWork(id: string): Promise<void>
  /** ゴミ箱の1件を完全に削除する（履歴も削除・不可逆）。 */
  purgeWork(id: string): Promise<void>
  /** ゴミ箱を空にする（全件を完全削除・不可逆）。 */
  emptyTrash(): Promise<void>
  /** 現在の作品から話を削除。現在話なら別の話（無ければ無し）へ切り替える。 */
  deleteEpisode(episodeId: string): Promise<void>
  /** 現在の作品の話タイトルを変更して永続化する（空文字・無変更は無視・本文は不変）。 */
  renameEpisode(episodeId: string, title: string): Promise<void>
  /** 現在の作品の話を、指定した id 順に並べ替えて永続化する（アウトラインの双方向同期）。 */
  reorderEpisodes(orderedIds: string[]): Promise<void>
  /** 作品メタ（タイトル・著者・あらすじ）を更新して永続化する。 */
  updateWorkMeta(id: string, meta: WorkMeta): Promise<void>
  importWorks(works: Work[]): Promise<void>
  getAllWorks(): Promise<Work[]>
  /** 辞書 entry を新規作成して永続化し、作成した entry を返す（name/別名の完全同名は拒否）。 */
  addGlossaryEntry(input: NewGlossaryEntry): Promise<GlossaryEntry>
  /** 辞書 entry の name 以外のフィールドを更新（name 変更は renameGlossaryEntry）。 */
  updateGlossaryEntry(id: string, patch: GlossaryFieldPatch): Promise<void>
  /** 辞書 entry を改名（①旧名を別名へ退避 ②opts.rewriteBody で本文 ref も書換）。同名は拒否。 */
  renameGlossaryEntry(id: string, newName: string, opts?: { rewriteBody?: boolean }): Promise<void>
  /** 辞書 entry を削除（本文の ref はそのまま＝未解決化する）。 */
  deleteGlossaryEntry(id: string): Promise<void>
  /** 作者プロフィール（ペンネーム・アバター）を更新して永続化する。空文字は未設定として扱う。 */
  updateProfile(input: ProfileInput): Promise<void>
  /**
   * アカウント側の表示名にペンネームを合わせる（`src/core/profile/account.ts` の判定を受ける）。
   * **アバターには触らない**＝アカウントを切り替えてもアバターは端末のまま残る。
   * 空文字を渡すと未設定に戻す（別アカウントの名前を伏せるとき）。
   */
  adoptPenName(penName: string, accountId: string | null): Promise<void>
}

/** プロフィール編集の入力（ダイアログが現在値を丸ごと持って submit する。空文字＝未設定）。 */
export interface ProfileInput {
  penName: string
  avatar: string
  /**
   * このペンネームを持つアカウント（Clerk userId）。**省略すると現在値を据え置く**。
   * `null` は「どのアカウントのものでもない」（未サインインでの編集）。
   */
  accountId?: string | null
}

/** 辞書 entry 新規作成の入力（id/createdAt/updatedAt はストアが付与）。 */
export interface NewGlossaryEntry {
  name: string
  aliases?: string[]
  category?: string
  reading?: string
  summary?: string
  body?: string
  /** 作者だけが見るメモ（公開時に落とす）。 */
  authorNote?: string
  /** サムネ画像の data URL。空文字/未指定なら付与しない。 */
  thumbnail?: string
  /** 対話ノート（対話で答えてから登録したとき）。 */
  dialog?: Record<string, DialogAnswer>
  dialogVersion?: number
}

/** 辞書 entry のフィールド更新パッチ（規則は core/glossary/patch。ここは再 export）。 */
export type { GlossaryFieldPatch } from '../../core/glossary/patch'

/** 作品メタ編集の入力（指定したキーのみ上書き）。 */
export interface WorkMeta {
  format?: Work['format']
  title?: string
  author?: string
  description?: string
  /** 脚本の梗概。空文字 '' は削除（キーを落とす）、undefined は据え置き。 */
  synopsis?: string
  /**
   * コトノハ-grove- への投稿設定。部分更新はせず丸ごと差し替える（投稿ダイアログが全項目を持つため）。
   * undefined は据え置き。
   */
  platform?: WorkPlatform
  /** 表紙画像の data URL。空文字 '' は削除（キーを落とす）、undefined は据え置き。 */
  coverImage?: string
}

export interface EditorStoreDeps {
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  profileRepo: ProfileRepository
  /** 執筆活動（日別の文字数増減）の記録先。純ローカル。 */
  activityRepo: ActivityRepository
  /**
   * 作品を完全削除したとき、その作品に紐づく構造レイヤー・プロットも一緒に消すための参照。
   * 渡さないと孤児レコードが端末に残り、同期でも運ばれ続ける（cloud 会員時のみ結線）。
   */
  structureRepo?: { removeByWork(workId: string): Promise<void> }
  plotRepo?: { removeByWork(workId: string): Promise<void> }
  stagingRepo?: { removeByWork(workId: string): Promise<void> }
  genId: () => string
  now: () => number
  /** 履歴の集約間隔(ms)。連続編集中はこの間隔内の保存を最新版へ合体し、版の氾濫を防ぐ。 */
  snapshotMinIntervalMs: number
  /** ゴミ箱の保持期間(ms)。init() でこれを過ぎた退避作品を自動 purge する。 */
  trashTtlMs: number
}

const INITIAL: EditorState = {
  workOperation: 'idle',
  workList: [],
  work: null,
  currentEpisodeId: null,
  draft: '',
  dirty: false,
  status: 'idle',
  snapshots: [],
  trashList: [],
  profile: {},
  profileAccountId: undefined,
}

const currentEpisode = (s: EditorState): Episode | undefined =>
  s.work?.episodes.find((e) => e.id === s.currentEpisodeId)

export function createEditorStore({
  repo,
  snapshotRepo,
  profileRepo,
  activityRepo,
  structureRepo,
  plotRepo,
  stagingRepo,
  genId,
  now,
  snapshotMinIntervalMs,
  trashTtlMs,
}: EditorStoreDeps): EditorStore {
  let state: EditorState = INITIAL
  const listeners = new Set<() => void>()
  // 復元直後の最初の保存は集約（record）せず必ず新しい版として積む（append）。
  // 集約すると「復元前＝現在の版」の最新スナップショットが復元内容で上書きされ、
  // 復元の取り消しができなくなるため。
  let appendNextSnapshot = false

  const emit = () => {
    for (const l of listeners) l()
  }

  /**
   * 作品の完全削除に伴う後始末。履歴（版）に加え、その作品の構造レイヤー・プロット・
   * 演出譜も消す。残すと本人には見えないまま端末に溜まり、同期にも載り続けるため。
   */
  const purgeWorkArtifacts = async (workId: string) => {
    await snapshotRepo.clear(workId)
    await structureRepo?.removeByWork(workId)
    await plotRepo?.removeByWork(workId)
    await stagingRepo?.removeByWork(workId)
  }
  const set = (patch: Partial<EditorState>) => {
    state = { ...state, ...patch }
    emit()
  }

  // ライブラリ一覧は最終更新の新しい順（updatedAt 降順・未設定の旧データは末尾）。
  const sortByUpdatedDesc = (list: WorkSummary[]): WorkSummary[] =>
    [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  const refreshList = async () => {
    set({ workList: sortByUpdatedDesc(await repo.listWorks()) })
  }

  const refreshTrash = async () => {
    const trash = await repo.listTrash()
    // 退避時刻の新しい順（最近捨てたものが上）
    trash.sort((a, b) => b.trashedAt - a.trashedAt)
    set({ trashList: trash })
  }

  /** Work mutations share a queue; failed operations never poison later operations. */
  let operationChain: Promise<unknown> = Promise.resolve()
  const serializeOperation = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = operationChain.then(fn, fn)
    operationChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const searchSources = (): SearchSource[] =>
    state.work?.episodes.map((e) => ({
      episodeId: e.id,
      title: e.title,
      text: e.id === state.currentEpisodeId ? state.draft : blocksToNotation(e.blocks),
    })) ?? []
  const assertFresh = async (workId: string, sources: readonly SearchSource[]) => {
    if (state.work?.id !== workId || JSON.stringify(searchSources()) !== JSON.stringify(sources)) {
      throw new Error('本文が変わりました。検索し直してください')
    }
    const persisted = await repo.getWork(workId)
    if (
      !persisted ||
      JSON.stringify(WorkSchema.parse(persisted)) !== JSON.stringify(WorkSchema.parse(state.work))
    ) {
      throw new Error('本文が変わりました。検索し直してください')
    }
  }

  const internal: EditorStore = {
    getSearchSources: searchSources,
    async replaceWorkMatches(input) {
      await assertFresh(input.workId, input.sources)
      const plans = planReplacement(input.sources, input.query, input.replacement, input.target)
      if (!plans.length || !state.work) return { count: 0, committed: false }
      const old = state.work
      const ep = currentEpisode(state)
      const before: Work = {
        ...old,
        episodes: old.episodes.map((e) => {
          if (e.id !== ep?.id || !state.dirty) return e
          const blocks = reconcileBlockIds(e.blocks, parseEpisodeBody(state.draft))
          return JSON.stringify(blocks) === JSON.stringify(e.blocks) ? e : { ...e, blocks }
        }),
      }
      const after: Work = {
        ...before,
        updatedAt: Math.max(now(), (old.updatedAt ?? 0) + 1),
        episodes: before.episodes.map((e) => {
          const plan = plans.find((p) => p.episodeId === e.id)
          return plan
            ? { ...e, blocks: reconcileBlockIds(e.blocks, parseEpisodeBody(plan.after)) }
            : e
        }),
      }
      const snapshots = await snapshotRepo.append(before, now(), genId())
      // Protect immediately: a failed body put must not let the next autosave replace this version.
      appendNextSnapshot = true
      set({ snapshots })
      await repo.saveWork(after)
      const draft = plans.find((p) => p.episodeId === state.currentEpisodeId)?.after ?? state.draft
      set({ work: after, draft, dirty: false, status: 'saved' })
      const count = plans.reduce((n, p) => n + p.count, 0)
      try {
        await activityRepo.record(countWorkChars(after) - countWorkChars(old), now())
        await refreshList()
        return { count, committed: true }
      } catch {
        return {
          count,
          committed: true,
          warning: '置換は保存しました。履歴や一覧の表示を更新できませんでした',
        }
      }
    },
    async navigateWorkMatch(input) {
      await assertFresh(input.workId, input.sources)
      const original = searchWork(input.sources, input.query).find(
        (m) =>
          m.episodeId === input.match.episodeId &&
          m.start === input.match.start &&
          m.end === input.match.end,
      )
      if (!original) throw new Error('本文が変わりました。検索し直してください')
      await internal.save()
      const ep = state.work?.episodes.find((e) => e.id === original.episodeId)
      if (!ep) throw new Error('本文が変わりました。検索し直してください')
      const savedText = blocksToNotation(ep.blocks)
      const matches = searchWork(
        [{ episodeId: ep.id, title: ep.title, text: savedText }],
        input.query,
      )
      const candidate = matches.find((m) => m.occurrence === original.occurrence)
      const originalSource = input.sources.find((s) => s.episodeId === ep.id)
      const normalized = originalSource && blocksToNotation(parseEpisodeBody(originalSource.text))
      if (!candidate || !originalSource || savedText !== normalized) {
        throw new Error('本文が変わりました。検索し直してください')
      }
      if (savedText !== originalSource.text) {
        const beforeMatches = searchWork([originalSource], input.query)
        const context = (text: string, match: SearchMatch) =>
          JSON.stringify([
            text.slice(Math.max(0, match.start - 30), match.start),
            text.slice(match.end, match.end + 30),
          ])
        const originalContext = context(originalSource.text, original)
        const corresponding = matches.filter(
          (match) => context(savedText, match) === originalContext,
        )
        // Normalization may remove notation symbols: never redirect to another occurrence.
        if (
          beforeMatches.length !== matches.length ||
          corresponding.length !== 1 ||
          corresponding[0] !== candidate
        ) {
          throw new Error('本文が変わりました。検索し直してください')
        }
      }
      internal.openEpisode(ep.id)
      return { start: candidate.start, end: candidate.end }
    },
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async init() {
      // 起動時にゴミ箱の期限切れ（30日超）を自動 purge し、履歴も掃除する。
      const trash = await repo.listTrash()
      for (const item of trash) {
        await withWorkMutationLock(item.id, async () => {
          const fresh = (await repo.listTrash()).find((entry) => entry.id === item.id)
          if (!fresh || fresh.trashedAt + trashTtlMs > now()) return
          await repo.purgeTrashedWork(item.id)
          await purgeWorkArtifacts(item.id)
        })
      }
      await refreshList()
      await refreshTrash()
      set({ profile: await profileRepo.get(), profileAccountId: await profileRepo.getAccountId() })
    },

    async createWork(title, format) {
      // 著者はプロフィールのペンネームを既定にする（未設定ならキーを付けない）。
      const author = state.profile.penName
      const work: Work = {
        id: genId(),
        title,
        episodes: [],
        updatedAt: now(),
        ...(author ? { author } : {}),
        ...(format === 'script' ? { format } : {}),
      }
      await repo.saveWork(work)
      set({
        work,
        currentEpisodeId: null,
        draft: '',
        dirty: false,
        status: 'idle',
        snapshots: [],
      })
      await refreshList()
    },

    async openWork(id) {
      const work = await repo.getWork(id)
      if (!work) return
      const first = work.episodes[0]
      set({
        work,
        currentEpisodeId: first?.id ?? null,
        draft: first ? blocksToNotation(first.blocks) : '',
        dirty: false,
        status: 'idle',
        snapshots: await snapshotRepo.list(work.id),
      })
    },

    async refreshOpenWork() {
      // 同期の pull が IndexedDB を書き換えた後、開いている作品のメモリ状態を追随させる
      // （追随しないと次の save() が古い状態で上書きし、pull を黙って巻き戻してしまう）。
      const cur = state.work
      if (!cur) return
      // 下書きに未保存の編集がある間は触らない（同期側も dirty 中は pull を見送る）。
      if (state.dirty || state.workOperation !== 'idle') return
      const fresh = await repo.getWork(cur.id)
      if (
        !fresh ||
        JSON.stringify(WorkSchema.parse(fresh)) === JSON.stringify(WorkSchema.parse(cur))
      )
        return
      // 開いていた話が残っていればそのまま、消えていれば先頭へ。下書きは新内容から組み直す。
      const keep = fresh.episodes.some((e) => e.id === state.currentEpisodeId)
      const epId = keep ? state.currentEpisodeId : (fresh.episodes[0]?.id ?? null)
      const ep = fresh.episodes.find((e) => e.id === epId)
      set({
        work: fresh,
        currentEpisodeId: epId,
        draft: ep ? blocksToNotation(ep.blocks) : '',
        dirty: false,
        status: 'idle',
        snapshots: await snapshotRepo.list(fresh.id),
      })
    },

    async createEpisode(title) {
      if (!state.work) return
      const episode: Episode = { id: genId(), title, blocks: [] }
      const work: Work = {
        ...state.work,
        episodes: [...state.work.episodes, episode],
        updatedAt: now(),
      }
      await repo.saveWork(work)
      set({ work, currentEpisodeId: episode.id, draft: '', dirty: false, status: 'idle' })
    },

    openEpisode(id) {
      const ep = state.work?.episodes.find((e) => e.id === id)
      if (!ep) return
      set({
        currentEpisodeId: id,
        draft: blocksToNotation(ep.blocks),
        dirty: false,
        status: 'idle',
      })
    },

    setDraft(text) {
      set({ draft: text, dirty: true, status: 'idle' })
    },

    async save() {
      const ep = currentEpisode(state)
      if (!state.work || !ep) return
      // 再パースで振り直された id を旧 blocks から引き継ぐ（演出譜 Staging のアンカー安定化）
      const blocks = reconcileBlockIds(ep.blocks, parseEpisodeBody(state.draft))
      // 本文に変化が無ければ永続化もスナップショットも行わない（保存の氾濫を防ぐ）
      if (JSON.stringify(ep.blocks) === JSON.stringify(blocks)) {
        set({ dirty: false, status: 'saved' })
        return
      }
      const savedDraft = state.draft
      const previousWork = state.work
      set({ status: 'saving' })
      const work: Work = {
        ...state.work,
        episodes: state.work.episodes.map((e) => (e.id === ep.id ? { ...e, blocks } : e)),
        updatedAt: now(),
      }
      await repo.saveWork(work)
      set({
        work,
        dirty: state.draft !== savedDraft,
        status: state.draft === savedDraft ? 'saved' : 'idle',
      })
      // 本文の純増減を日別の執筆活動へ記録（草・ストリーク用）。state.work は保存前の旧状態。
      await activityRepo.record(countWorkChars(work) - countWorkChars(previousWork), now())
      // 連続編集中は最新版へ合体し、間隔を空けた保存だけ新しい版として積む
      const snapshots = appendNextSnapshot
        ? await snapshotRepo.append(work, now(), genId())
        : await snapshotRepo.record(work, now(), genId(), snapshotMinIntervalMs)
      appendNextSnapshot = false
      set({ snapshots })
      await refreshList()
    },

    restoreSnapshot(snapshotId) {
      const snap = state.snapshots.find((s) => s.id === snapshotId)
      if (!snap) return
      // 現在開いている話の当時の版を優先。無ければ先頭話にフォールバック。
      const ep =
        snap.work.episodes.find((e) => e.id === state.currentEpisodeId) ?? snap.work.episodes[0]
      if (!ep) return
      appendNextSnapshot = true
      set({
        currentEpisodeId: ep.id,
        draft: blocksToNotation(ep.blocks),
        dirty: true,
        status: 'idle',
      })
    },

    async trashWork(id) {
      // ソフト削除：履歴（snap:<id>）は復元のため残し、本体だけ trash 名前空間へ退避。
      const trashedAt = now()
      await repo.trashWork(id, trashedAt)
      const workList = sortByUpdatedDesc(await repo.listWorks())
      if (state.work?.id === id) {
        set({
          workList,
          work: null,
          currentEpisodeId: null,
          draft: '',
          dirty: false,
          status: 'idle',
          snapshots: [],
        })
      } else {
        set({ workList })
      }
      await refreshTrash()
      // 共有ゴミ箱：ゴミ箱状態をリモートへ即時伝播（端末切替でも相手が気づける）。
    },

    async restoreWork(id) {
      await repo.restoreWork(id)
      await refreshList()
      await refreshTrash()
      // 復元をリモートへ即時伝播（trashed_at=0）。内容 push は差分無しだと飛ばないため PATCH で確実に。
    },

    async purgeWork(id) {
      await repo.purgeTrashedWork(id)
      await purgeWorkArtifacts(id)
      await refreshTrash()
    },

    async emptyTrash() {
      for (const t of state.trashList) {
        await repo.purgeTrashedWork(t.id)
        await purgeWorkArtifacts(t.id)
      }
      await refreshTrash()
    },

    async deleteEpisode(episodeId) {
      if (!state.work) return
      const episodes = state.work.episodes.filter((e) => e.id !== episodeId)
      const work: Work = { ...state.work, episodes, updatedAt: now() }
      await repo.saveWork(work)
      if (state.currentEpisodeId === episodeId) {
        const next = episodes[0] ?? null
        set({
          work,
          currentEpisodeId: next?.id ?? null,
          draft: next ? blocksToNotation(next.blocks) : '',
          dirty: false,
          status: 'idle',
        })
      } else {
        set({ work })
      }
      await refreshList()
    },

    async renameEpisode(episodeId, title) {
      if (!state.work) return
      const trimmed = title.trim()
      const target = state.work.episodes.find((e) => e.id === episodeId)
      // 空文字・無変更・該当なしは no-op（本文/下書き/スナップショットには触れない）。
      if (trimmed === '' || !target || target.title === trimmed) return
      const work: Work = {
        ...state.work,
        episodes: state.work.episodes.map((e) =>
          e.id === episodeId ? { ...e, title: trimmed } : e,
        ),
        updatedAt: now(),
      }
      await repo.saveWork(work)
      set({ work })
      await refreshList()
    },

    async reorderEpisodes(orderedIds) {
      if (!state.work) return
      const byId = new Map(state.work.episodes.map((e) => [e.id, e]))
      // orderedIds の順に並べ、漏れた話（未知IDや欠落）は元の相対順で末尾に補完する。
      const reordered = orderedIds.map((id) => byId.get(id)).filter((e): e is Episode => e != null)
      const seen = new Set(reordered.map((e) => e.id))
      const rest = state.work.episodes.filter((e) => !seen.has(e.id))
      const episodes = [...reordered, ...rest]
      // 順序が変わらないなら no-op（保存もしない）。
      if (episodes.every((e, i) => e.id === state.work?.episodes[i]?.id)) return
      const work: Work = { ...state.work, episodes, updatedAt: now() }
      await repo.saveWork(work)
      set({ work })
      await refreshList()
    },

    async updateWorkMeta(id, meta) {
      const existing = await repo.getWork(id)
      if (!existing) return
      // coverImage は空文字 '' を「削除」とする（undefined＝据え置きと区別するため別扱い）。
      const { coverImage, format, synopsis, ...rest } = meta
      const work: Work = { ...existing, ...rest, updatedAt: now() }
      if (format === 'novel') delete work.format
      else if (format !== undefined) work.format = format
      if (synopsis === '') delete work.synopsis
      else if (synopsis !== undefined) work.synopsis = synopsis
      if (coverImage === '') delete work.coverImage
      else if (coverImage !== undefined) work.coverImage = coverImage
      await repo.saveWork(work)
      if (state.work?.id === id) set({ work })
      await refreshList()
    },

    async importWorks(works) {
      for (const w of works) await repo.saveWork(w)
      await refreshList()
    },

    async getAllWorks() {
      const list = await repo.listWorks()
      const works = await Promise.all(list.map((w) => repo.getWork(w.id)))
      return works.filter((w): w is Work => w !== undefined)
    },

    addGlossaryEntry(input) {
      return (async () => {
        if (!state.work) throw new Error('作品が開かれていません')
        // 名前は @ 参照の解決キー。空の項目は解決できず一覧で「？」になるだけなので作らない。
        if (input.name.trim() === '') throw new Error('名前を入れてください')
        const entries = state.work.glossary ?? []
        const ts = now()
        const entry: GlossaryEntry = {
          id: genId(),
          name: input.name,
          aliases: input.aliases ?? [],
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.reading !== undefined ? { reading: input.reading } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.authorNote !== undefined ? { authorNote: input.authorNote } : {}),
          // 空文字/未指定は付与しない（クイック作成・サムネ未設定の作成経路を許容）。
          ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
          // 対話で答えてから登録した項目は、答えごと保存する（空の record は持たない）。
          ...(input.dialog && Object.keys(input.dialog).length > 0
            ? { dialog: input.dialog, dialogVersion: input.dialogVersion ?? DIALOG_VERSION }
            : {}),
          createdAt: ts,
          updatedAt: ts,
        }
        // D-GLOS-UNIQUE: 新 entry の name/別名が既存 entry の name/別名と完全一致したら拒否
        for (const key of [entry.name, ...entry.aliases]) {
          if (key.trim() === '') continue
          if (resolveRef(key, entries)) throw new Error(`「${key}」は既存の項目と重複しています`)
        }
        const work: Work = { ...state.work, glossary: [...entries, entry], updatedAt: ts }
        await repo.saveWork(work)
        set({ work })
        await refreshList()
        return entry
      })()
    },

    updateGlossaryEntry(id, patch) {
      return (async () => {
        if (!state.work) return
        const entries = state.work.glossary ?? []
        const cur = entries.find((e) => e.id === id)
        if (!cur) return
        // 別名を変更するときは他 entry の name/別名との衝突を拒否（D-GLOS-UNIQUE）
        if (patch.aliases) {
          const others = entries.filter((e) => e.id !== id)
          for (const a of patch.aliases) {
            if (a.trim() === '') continue
            if (resolveRef(a, others)) throw new Error(`「${a}」は既存の項目と重複しています`)
          }
        }
        const ts = now()
        const updated = applyGlossaryFieldPatch(cur, patch, ts)
        const work: Work = {
          ...state.work,
          glossary: entries.map((e) => (e.id === id ? updated : e)),
          updatedAt: ts,
        }
        await repo.saveWork(work)
        set({ work })
        await refreshList()
      })()
    },

    renameGlossaryEntry(id, newName, opts) {
      return (async () => {
        if (!state.work) return
        // renameEntry が衝突を throw・no-op なら同一参照を返す（自動エイリアス＋任意の本文書換）
        const renamed = renameEntry(state.work, id, newName, opts ?? {})
        if (renamed === state.work) return
        const ts = now()
        const work: Work = {
          ...renamed,
          glossary: (renamed.glossary ?? []).map((e) =>
            e.id === id ? { ...e, updatedAt: ts } : e,
          ),
          updatedAt: ts,
        }
        await repo.saveWork(work)
        const patch: Partial<EditorState> = { work }
        // rewriteBody で現在話の本文が変わったら draft も再生成する。
        // そうしないと古い名前を保持した draft が次の save で本文を巻き戻してしまう。
        // 未保存編集（dirty）中は上書きを避け、ユーザーの下書きを優先する。
        if (opts?.rewriteBody && !state.dirty) {
          const ep = work.episodes.find((e) => e.id === state.currentEpisodeId)
          if (ep) {
            patch.draft = blocksToNotation(ep.blocks)
            patch.dirty = false
          }
        }
        set(patch)
        await refreshList()
      })()
    },

    deleteGlossaryEntry(id) {
      return (async () => {
        if (!state.work) return
        const entries = state.work.glossary ?? []
        if (!entries.some((e) => e.id === id)) return
        // 本文の ref はそのまま残す＝解決先を失い未解決リンク化する（仕様どおり）
        const work: Work = {
          ...state.work,
          glossary: entries.filter((e) => e.id !== id),
          updatedAt: now(),
        }
        await repo.saveWork(work)
        set({ work })
        await refreshList()
      })()
    },

    async updateProfile(input) {
      // ダイアログが現在値を丸ごと持つので、空文字のフィールドは未設定として落とす。
      // updatedAt は端末間 LWW 用（クラウド同期の勝者判定）。
      const profile: Profile = { updatedAt: now() }
      const penName = input.penName.trim()
      if (penName) profile.penName = penName
      if (input.avatar) profile.avatar = input.avatar
      // ダイアログに無い欄（どのアカウントの名前か）は据え置く＝1 欄の更新で他を落とさない。
      const kept =
        input.accountId === undefined ? state.profileAccountId : (input.accountId ?? undefined)
      // 名前を消したら、誰の名前かの印も残さない（次のサインインで拾い直す）。
      const profileAccountId = penName ? kept : undefined
      await profileRepo.save(profile)
      await profileRepo.saveAccountId(profileAccountId)
      set({ profile, profileAccountId })
    },

    async adoptPenName(penName, accountId) {
      const next: Profile = { ...state.profile, updatedAt: now() }
      const name = penName.trim()
      if (name) next.penName = name
      else delete next.penName
      const profileAccountId = name && accountId ? accountId : undefined
      await profileRepo.save(next)
      await profileRepo.saveAccountId(profileAccountId)
      set({ profile: next, profileAccountId })
    },
  }
  const publicStore: EditorStore = { ...internal }
  const serialized = [
    'init',
    'createWork',
    'openWork',
    'refreshOpenWork',
    'createEpisode',
    'save',
    'trashWork',
    'restoreWork',
    'purgeWork',
    'emptyTrash',
    'deleteEpisode',
    'renameEpisode',
    'reorderEpisodes',
    'updateWorkMeta',
    'importWorks',
    'addGlossaryEntry',
    'updateGlossaryEntry',
    'renameGlossaryEntry',
    'deleteGlossaryEntry',
    'replaceWorkMatches',
    'navigateWorkMatch',
  ] as const
  for (const name of serialized) {
    // Preserve each public method's signature; all calls share the same operation queue.
    const invoke = internal[name] as (...args: unknown[]) => Promise<unknown>
    Object.assign(publicStore, {
      [name]: (...args: unknown[]) => {
        if (state.workOperation !== 'idle' && name !== 'save' && name !== 'refreshOpenWork') {
          return Promise.reject(new Error('処理が終わるまでお待ちください'))
        }
        const operation =
          name === 'replaceWorkMatches'
            ? 'replacing'
            : name === 'navigateWorkMatch'
              ? 'navigating'
              : null
        if (operation) set({ workOperation: operation })
        return serializeOperation(async () => {
          const explicit = [
            'trashWork',
            'restoreWork',
            'purgeWork',
            'updateWorkMeta',
            'openWork',
          ].includes(name)
          const input = args[0] as { workId?: string } | undefined
          const workId = explicit ? (args[0] as string) : operation ? input?.workId : state.work?.id
          const run = async () => {
            const writesOpenWork = [
              'save',
              'createEpisode',
              'deleteEpisode',
              'renameEpisode',
              'reorderEpisodes',
              'addGlossaryEntry',
              'updateGlossaryEntry',
              'renameGlossaryEntry',
              'deleteGlossaryEntry',
            ].includes(name)
            const updatesOpenMeta = name === 'updateWorkMeta' && args[0] === state.work?.id
            if ((writesOpenWork || updatesOpenMeta) && state.work) {
              await assertFresh(state.work.id, searchSources())
            }
            return invoke(...args)
          }
          try {
            // Bulk imports acquire individual locks, rather than re-entering the current work lock.
            if (name === 'importWorks') {
              for (const work of args[0] as Work[])
                await withWorkMutationLock(work.id, () => repo.saveWork(work))
              await refreshList()
              return
            }
            if (name === 'emptyTrash') {
              for (const trash of state.trashList)
                await withWorkMutationLock(trash.id, async () => {
                  await repo.purgeTrashedWork(trash.id)
                  await purgeWorkArtifacts(trash.id)
                })
              await refreshTrash()
              return
            }
            return workId && name !== 'init' ? await withWorkMutationLock(workId, run) : await run()
          } finally {
            if (operation) set({ workOperation: 'idle' })
            if (state.status === 'saving') set({ status: 'idle' })
          }
        })
      },
    })
  }
  for (const name of ['openEpisode', 'setDraft', 'restoreSnapshot'] as const) {
    const invoke = internal[name] as (...args: unknown[]) => void
    Object.assign(publicStore, {
      [name]: (...args: unknown[]) => {
        if (state.workOperation === 'idle') invoke(...args)
      },
    })
  }
  return publicStore
}
