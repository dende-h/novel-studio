import { blocksToKakuyomu } from '../../core/exporter/toKakuyomu'
import { parseEpisodeBody } from '../../core/parser/parseNotation'
import type { Episode, Work } from '../../core/schema'
import type { Snapshot } from '../../core/snapshot'
import type { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
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
  /** 現在の作品のスナップショット履歴（新しい順） */
  snapshots: Snapshot[]
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
  importWorks(works: Work[]): Promise<void>
  getAllWorks(): Promise<Work[]>
}

export interface EditorStoreDeps {
  repo: WorkRepository
  snapshotRepo: SnapshotRepository
  genId: () => string
  now: () => number
}

const INITIAL: EditorState = {
  workList: [],
  work: null,
  currentEpisodeId: null,
  draft: '',
  dirty: false,
  status: 'idle',
  snapshots: [],
}

const currentEpisode = (s: EditorState): Episode | undefined =>
  s.work?.episodes.find((e) => e.id === s.currentEpisodeId)

export function createEditorStore({
  repo,
  snapshotRepo,
  genId,
  now,
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
      const work: Work = { id: genId(), title, episodes: [], updatedAt: now() }
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
        draft: first ? blocksToKakuyomu(first.blocks) : '',
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
        updatedAt: now(),
      }
      await repo.saveWork(work)
      const snapshots = await snapshotRepo.append(work, now(), genId())
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
        draft: blocksToKakuyomu(ep.blocks),
        dirty: true,
        status: 'idle',
      })
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
