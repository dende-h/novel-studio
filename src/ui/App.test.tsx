import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SnapshotRepository } from '../core/snapshot/snapshotRepository'
import { MemoryStore } from '../core/storage/memoryStore'
import type { KeyValueStore } from '../core/storage/types'
import { WorkRepository } from '../core/storage/workRepository'
import { App } from './App'
import { createEditorStore, type EditorStore } from './store/editorStore'

const makeStore = (kv: KeyValueStore = new MemoryStore()): EditorStore => {
  let n = 0
  const repo = new WorkRepository(kv)
  const snapshotRepo = new SnapshotRepository(kv)
  return createEditorStore({
    repo,
    snapshotRepo,
    genId: () => `id${++n}`,
    now: () => Date.now(),
    snapshotMinIntervalMs: 0,
  })
}

const seedWorkEpisode = async (store: EditorStore) => {
  await store.createWork('作品ワン')
  await store.createEpisode('第一話')
}

describe('App（エディタ結合：本文/プレビュー・自動保存・履歴）', () => {
  it('作品が開かれていない時はライブラリ誘導を表示', () => {
    render(<App store={makeStore()} />)
    expect(screen.getByText(/ライブラリから作品を開いて/)).toBeInTheDocument()
  })

  it('本文入力でライブプレビューが追従（ルビ/傍点）', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    const textarea = await screen.findByRole('textbox', { name: '本文' })
    fireEvent.change(textarea, { target: { value: '漢字《かんじ》\n《《重要》》' } })

    await waitFor(() => {
      expect(document.querySelector('.preview ruby rt')?.textContent).toBe('かんじ')
      expect(document.querySelector('.preview em.dots')?.textContent).toBe('重要')
    })
  })

  it('自動保存で永続化され、再読込相当で本文を復元できる', async () => {
    const kv = new MemoryStore()
    const store1 = makeStore(kv)
    await seedWorkEpisode(store1)
    const workId = store1.getSnapshot().work?.id ?? ''

    const { unmount } = render(<App store={store1} />)
    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '保存される本文' },
    })
    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument(), { timeout: 2000 })
    unmount()

    // 同じ永続ストアの別エディタ = 再読込
    const store2 = makeStore(kv)
    await store2.openWork(workId)
    render(<App store={store2} />)
    expect(await screen.findByRole('textbox', { name: '本文' })).toHaveValue('保存される本文')
  })

  it('「新しいエピソードを追加」ダイアログで話を作成しサブリストに表示', async () => {
    const store = makeStore()
    await store.createWork('作品ワン')
    render(<App store={store} />)

    fireEvent.click(screen.getByRole('button', { name: '新しいエピソードを追加' }))
    const input = await screen.findByLabelText('話タイトル')
    fireEvent.change(input, { target: { value: '序章' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('button', { name: '序章' })).toBeInTheDocument()
  })

  it('保存すると履歴パネルに版が記録される（トグルで開閉できる）', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: 'テスト本文' },
    })
    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument(), { timeout: 2000 })

    // 初期は履歴ドロワー非表示
    expect(screen.queryByText('ローカル・セーフティネット')).toBeNull()

    // 履歴トグルで開く
    fireEvent.click(screen.getByRole('button', { name: '履歴' }))
    expect(screen.getByText('ローカル・セーフティネット')).toBeInTheDocument()
    expect(screen.getByText('現在の版')).toBeInTheDocument()

    // 閉じるボタンで閉じる
    fireEvent.click(screen.getByRole('button', { name: '履歴を閉じる' }))
    expect(screen.queryByText('ローカル・セーフティネット')).toBeNull()
  })
})
