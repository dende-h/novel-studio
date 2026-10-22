import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileRepository } from '../core/profile'
import type { NameCandidate } from '../core/proofread'
import { SnapshotRepository } from '../core/snapshot/snapshotRepository'
import { ActivityRepository } from '../core/storage/activityRepository'
import { MemoryStore } from '../core/storage/memoryStore'
import { NameDismissalRepository } from '../core/storage/nameDismissalRepository'
import { ProofreadRepository } from '../core/storage/proofreadRepository'
import { WorkRepository } from '../core/storage/workRepository'
import { App } from './App'
import { ToastProvider } from './components/Toast/toast'
import type { AnalyzerState, MorphAnalyzerClient } from './proofread/analyzer-client'
import { createEditorStore } from './store/editorStore'

/**
 * 推敲画面の「用語集に登録」から、実物のクイック作成ダイアログを通す（COT-59 FR-4）。
 * 解析器は happy-dom の Worker では動かないので、決まった候補を返す偽物に差し替える（このファイルだけ）。
 */
const CANDIDATES: NameCandidate[] = [
  {
    name: 'リリアーナ',
    count: 2,
    episodes: 1,
    signals: ['katakana'],
    category: '人物',
    reading: 'りりあーな',
  },
  {
    name: '新宿',
    count: 2,
    episodes: 1,
    signals: ['dict-proper'],
    category: '場所',
    reading: 'しんじゅく',
  },
  { name: '湊斗', count: 2, episodes: 1, signals: ['split-kanji'] },
]

vi.mock('@/ui/proofread/analyzer-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proofread/analyzer-client')>()
  return {
    ...actual,
    createMorphAnalyzerClient: (): MorphAnalyzerClient => {
      let state: AnalyzerState = { status: 'idle' }
      const listeners = new Set<() => void>()
      const set = (s: AnalyzerState) => {
        state = s
        for (const l of listeners) l()
      }
      return {
        getState: () => state,
        subscribe: (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
        start: () => set({ status: 'ready', work: null }),
        stop: () => {},
        analyze: async () => ({
          currentTokens: [],
          workVariants: { groups: [], groupOf: {} },
          frequent: [],
          frequentCurrent: [],
          names: CANDIDATES,
        }),
      }
    },
  }
})

const makeStore = (kv: MemoryStore) => {
  let n = 0
  return createEditorStore({
    repo: new WorkRepository(kv),
    snapshotRepo: new SnapshotRepository(kv),
    profileRepo: new ProfileRepository(kv),
    activityRepo: new ActivityRepository(kv),
    genId: () => `id${++n}`,
    now: () => Date.now(),
    snapshotMinIntervalMs: 0,
    trashTtlMs: Number.MAX_SAFE_INTEGER,
  })
}

const setWidth = (width: number) => {
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport: (v: { width: number }) => void }
  }
  act(() => {
    happyDOM.setViewport({ width })
  })
}

async function openNames() {
  const kv = new MemoryStore()
  const store = makeStore(kv)
  await store.createWork('作品ワン')
  await store.createEpisode('第一話')
  store.setDraft('「リリアーナ様」\n　湊斗は新宿にいた。湊斗が笑う。リリアーナが来た。新宿は雨だ。')
  await store.save()
  render(
    <ToastProvider>
      <App
        store={store}
        proofreadRepo={new ProofreadRepository(kv)}
        nameDismissalRepo={new NameDismissalRepository(kv)}
        canUseStructure
      />
    </ToastProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '推敲' }))
  fireEvent.click(await screen.findByRole('tab', { name: '分析' }))
  await screen.findByRole('button', { name: 'リリアーナを用語集に登録' })
  return { store }
}

/** 名前の行の、名前のボタン（押すと本文に印を付ける）。 */
const nameButton = (name: string) =>
  screen
    .getAllByRole('button', { name: new RegExp(`^${name}`) })
    .find((b) => b.hasAttribute('aria-pressed')) as HTMLElement

describe('推敲画面の「用語集に登録」（COT-59）', () => {
  beforeEach(() => setWidth(1280))
  afterEach(() => setWidth(1280))

  it('名前・読み・カテゴリ入りで開き、作成すると用語集に入って一覧から消え、閉じたら次の行へ', async () => {
    const { store } = await openNames()
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを用語集に登録' }))
    expect(await screen.findByLabelText('名前')).toHaveValue('リリアーナ')
    expect(screen.getByLabelText('読み')).toHaveValue('りりあーな')
    expect(screen.getByLabelText('カテゴリ')).toHaveValue('人物')
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(screen.queryByLabelText('名前')).toBeNull())
    expect(store.getSnapshot().work?.glossary?.[0]).toMatchObject({
      name: 'リリアーナ',
      reading: 'りりあーな',
      category: '人物',
    })
    expect(screen.queryByRole('button', { name: 'リリアーナを用語集に登録' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(nameButton('新宿')))
  })

  it('分類が無い候補は未分類で開き、キャンセルすると何も変えず押したボタンへ戻る', async () => {
    const { store } = await openNames()
    fireEvent.click(screen.getByRole('button', { name: '湊斗を用語集に登録' }))
    expect(await screen.findByLabelText('名前')).toHaveValue('湊斗')
    expect(screen.getByLabelText('読み')).toHaveValue('')
    expect(screen.getByLabelText('カテゴリ')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByLabelText('名前')).toBeNull())
    expect(store.getSnapshot().work?.glossary ?? []).toEqual([])
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '湊斗を用語集に登録' }),
      ),
    )
  })

  it('名前を直して作成すると、元の候補は一覧に残り、その行の名前のボタンへ戻る', async () => {
    const { store } = await openNames()
    fireEvent.click(screen.getByRole('button', { name: '新宿を用語集に登録' }))
    fireEvent.change(await screen.findByLabelText('名前'), { target: { value: '新宿区' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(screen.queryByLabelText('名前')).toBeNull())
    expect(store.getSnapshot().work?.glossary?.[0]?.name).toBe('新宿区')
    expect(screen.getByRole('button', { name: '新宿を用語集に登録' })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(nameButton('新宿')))
  })
})
