import { blocksToNotation } from '../../core/exporter/blocksToNotation'
import { renameEntry, resolveRef } from '../../core/glossary'
import { parseEpisodeBody } from '../../core/parser/parseNotation'
import type { Profile, ProfileRepository } from '../../core/profile'
import type { Episode, GlossaryEntry, Work } from '../../core/schema'
import type { Snapshot } from '../../core/snapshot'
import type { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
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
}

export interface EditorStore {
  getSnapshot(): EditorState
  subscribe(listener: () => void): () => void
  init(): Promise<void>
  createWork(title: string): Promise<void>
  openWork(id: string): Promise<void>
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
}

/** プロフィール編集の入力（ダイアログが現在値を丸ごと持って submit する。空文字＝未設定）。 */
export interface ProfileInput {
  penName: string
  avatar: string
}

/** 辞書 entry 新規作成の入力（id/createdAt/updatedAt はストアが付与）。 */
export interface NewGlossaryEntry {
  name: string
  aliases?: string[]
  category?: string
  reading?: string
  summary?: string
  body?: string
  /** サムネ画像の data URL。空文字/未指定なら付与しない。 */
  thumbnail?: string
}

/** 辞書 entry のフィールド更新パッチ（name は対象外＝renameGlossaryEntry を使う）。 */
export interface GlossaryFieldPatch {
  aliases?: string[]
  category?: string
  reading?: string
  summary?: string
  body?: string
  /** サムネ画像の data URL。空文字 '' は削除（キーを落とす）、undefined は据え置き。 */
  thumbnail?: string
}

/** 作品メタ編集の入力（指定したキーのみ上書き）。 */
export interface WorkMeta {
  title?: string
  author?: string
  description?: string
  /** 表紙画像の data URL。空文字 '' は削除（キーを落とす）、undefined は据え置き。 */
  coverImage?: string
}

export interface EditorStoreDeps {
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  profileRepo: ProfileRepository
  genId: () => string
  now: () => number
  /** 履歴の集約間隔(ms)。連続編集中はこの間隔内の保存を最新版へ合体し、版の氾濫を防ぐ。 */
  snapshotMinIntervalMs: number
  /** ゴミ箱の保持期間(ms)。init() でこれを過ぎた退避作品を自動 purge する。 */
  trashTtlMs: number
}

const INITIAL: EditorState = {
  workList: [],
  work: null,
  currentEpisodeId: null,
  draft: '',
  dirty: false,
  status: 'idle',
  snapshots: [],
  trashList: [],
  profile: {},
}

const currentEpisode = (s: EditorState): Episode | undefined =>
  s.work?.episodes.find((e) => e.id === s.currentEpisodeId)

export function createEditorStore({
  repo,
  snapshotRepo,
  profileRepo,
  genId,
  now,
  snapshotMinIntervalMs,
  trashTtlMs,
}: EditorStoreDeps): EditorStore {
  let state: EditorState = INITIAL
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const l of listeners) l()
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

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async init() {
      // 起動時にゴミ箱の期限切れ（30日超）を自動 purge し、履歴も掃除する。
      const purged = await repo.purgeExpiredTrash(now(), trashTtlMs)
      for (const id of purged) await snapshotRepo.clear(id)
      await refreshList()
      await refreshTrash()
      set({ profile: await profileRepo.get() })
    },

    async createWork(title) {
      // 著者はプロフィールのペンネームを既定にする（未設定ならキーを付けない）。
      const author = state.profile.penName
      const work: Work = {
        id: genId(),
        title,
        episodes: [],
        updatedAt: now(),
        ...(author ? { author } : {}),
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
      const blocks = parseEpisodeBody(state.draft)
      // 本文に変化が無ければ永続化もスナップショットも行わない（保存の氾濫を防ぐ）
      if (JSON.stringify(ep.blocks) === JSON.stringify(blocks)) {
        set({ dirty: false, status: 'saved' })
        return
      }
      set({ status: 'saving' })
      const work: Work = {
        ...state.work,
        episodes: state.work.episodes.map((e) => (e.id === ep.id ? { ...e, blocks } : e)),
        updatedAt: now(),
      }
      await repo.saveWork(work)
      // 連続編集中は最新版へ合体し、間隔を空けた保存だけ新しい版として積む
      const snapshots = await snapshotRepo.record(work, now(), genId(), snapshotMinIntervalMs)
      set({ work, dirty: false, status: 'saved', snapshots })
      await refreshList()
    },

    restoreSnapshot(snapshotId) {
      const snap = state.snapshots.find((s) => s.id === snapshotId)
      if (!snap) return
      // 現在開いている話の当時の版を優先。無ければ先頭話にフォールバック。
      const ep =
        snap.work.episodes.find((e) => e.id === state.currentEpisodeId) ?? snap.work.episodes[0]
      if (!ep) return
      set({
        currentEpisodeId: ep.id,
        draft: blocksToNotation(ep.blocks),
        dirty: true,
        status: 'idle',
      })
    },

    async trashWork(id) {
      // ソフト削除：履歴（snap:<id>）は復元のため残し、本体だけ trash 名前空間へ退避。
      await repo.trashWork(id, now())
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
    },

    async restoreWork(id) {
      await repo.restoreWork(id)
      await refreshList()
      await refreshTrash()
    },

    async purgeWork(id) {
      await repo.purgeTrashedWork(id)
      await snapshotRepo.clear(id)
      await refreshTrash()
    },

    async emptyTrash() {
      for (const t of state.trashList) {
        await repo.purgeTrashedWork(t.id)
        await snapshotRepo.clear(t.id)
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

    async updateWorkMeta(id, meta) {
      const existing = await repo.getWork(id)
      if (!existing) return
      // coverImage は空文字 '' を「削除」とする（undefined＝据え置きと区別するため別扱い）。
      const { coverImage, ...rest } = meta
      const work: Work = { ...existing, ...rest, updatedAt: now() }
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

    async addGlossaryEntry(input) {
      if (!state.work) throw new Error('作品が開かれていません')
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
        // 空文字/未指定は付与しない（クイック作成・サムネ未設定の作成経路を許容）。
        ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
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
    },

    async updateGlossaryEntry(id, patch) {
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
      const updated: GlossaryEntry = { ...cur, ...patch, updatedAt: ts }
      // thumbnail は空文字 '' を「削除」とする（undefined＝据え置きと区別）。
      if (patch.thumbnail === '') delete updated.thumbnail
      const work: Work = {
        ...state.work,
        glossary: entries.map((e) => (e.id === id ? updated : e)),
        updatedAt: ts,
      }
      await repo.saveWork(work)
      set({ work })
      await refreshList()
    },

    async renameGlossaryEntry(id, newName, opts) {
      if (!state.work) return
      // renameEntry が衝突を throw・no-op なら同一参照を返す（自動エイリアス＋任意の本文書換）
      const renamed = renameEntry(state.work, id, newName, opts ?? {})
      if (renamed === state.work) return
      const ts = now()
      const work: Work = {
        ...renamed,
        glossary: (renamed.glossary ?? []).map((e) => (e.id === id ? { ...e, updatedAt: ts } : e)),
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
    },

    async deleteGlossaryEntry(id) {
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
    },

    async updateProfile(input) {
      // ダイアログが現在値を丸ごと持つので、空文字のフィールドは未設定として落とす。
      const profile: Profile = {}
      const penName = input.penName.trim()
      if (penName) profile.penName = penName
      if (input.avatar) profile.avatar = input.avatar
      await profileRepo.save(profile)
      set({ profile })
    },
  }
}
