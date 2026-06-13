import { blocksToKakuyomu } from '../../core/exporter/toKakuyomu'
import { parseEpisodeBody } from '../../core/parser/parseNotation'
import type { Episode, Work } from '../../core/schema'
import type { WorkRepository, WorkSummary } from '../../core/storage/workRepository'

/**
 * 執筆エディタの自前最小ストア（useSyncExternalStore 用）。
 * - draft = 現在話の生記法テキスト。保存時に parseEpisodeBody で正本 blocks へ。
 * - 話を開く時は blocksToKakuyomu でロスレスに記法テキストへ戻す。
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
  importWorks(works: Work[]): Promise<void>
  getAllWorks(): Promise<Work[]>
}

export interface EditorStoreDeps {
  repo: WorkRepository
  genId: () => string
}

const INITIAL: EditorState = {
  workList: [],
  work: null,
  currentEpisodeId: null,
  draft: '',
  dirty: false,
  status: 'idle',
}

const currentEpisode = (s: EditorState): Episode | undefined =>
  s.work?.episodes.find((e) => e.id === s.currentEpisodeId)

export function createEditorStore({ repo, genId }: EditorStoreDeps): EditorStore {
  let state: EditorState = INITIAL
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const l of listeners) l()
  }
  const set = (patch: Partial<EditorState>) => {
    state = { ...state, ...patch }
    emit()
  }

  const refreshList = async () => {
    set({ workList: await repo.listWorks() })
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
      await refreshList()
    },

    async createWork(title) {
      const work: Work = { id: genId(), title, episodes: [] }
      await repo.saveWork(work)
      set({ work, currentEpisodeId: null, draft: '', dirty: false, status: 'idle' })
      await refreshList()
    },

    async openWork(id) {
      const work = await repo.getWork(id)
      if (!work) return
      const first = work.episodes[0]
      set({
        work,
        currentEpisodeId: first?.id ?? null,
        draft: first ? blocksToKakuyomu(first.blocks) : '',
        dirty: false,
        status: 'idle',
      })
    },

    async createEpisode(title) {
      if (!state.work) return
      const episode: Episode = { id: genId(), title, blocks: [] }
      const work: Work = { ...state.work, episodes: [...state.work.episodes, episode] }
      await repo.saveWork(work)
      set({ work, currentEpisodeId: episode.id, draft: '', dirty: false, status: 'idle' })
    },

    openEpisode(id) {
      const ep = state.work?.episodes.find((e) => e.id === id)
      if (!ep) return
      set({
        currentEpisodeId: id,
        draft: blocksToKakuyomu(ep.blocks),
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
      set({ status: 'saving' })
      const blocks = parseEpisodeBody(state.draft)
      const work: Work = {
        ...state.work,
        episodes: state.work.episodes.map((e) => (e.id === ep.id ? { ...e, blocks } : e)),
      }
      await repo.saveWork(work)
      set({ work, dirty: false, status: 'saved' })
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
  }
}
