import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { WorkRepository } from '@/core/storage/workRepository'
import { createEditorStore, type EditorStore } from '@/ui/store/editorStore'
import { Library } from './library'

const makeStore = (): EditorStore => {
  let n = 0
  const kv = new MemoryStore()
  return createEditorStore({
    repo: new WorkRepository(kv),
    snapshotRepo: new SnapshotRepository(kv),
    genId: () => `id${++n}`,
    now: () => Date.now(),
    snapshotMinIntervalMs: 0,
    trashTtlMs: Number.MAX_SAFE_INTEGER,
  })
}

describe('Library ゴミ箱導線', () => {
  it('削除→ゴミ箱へ移動→復元 が UI で一周する', async () => {
    const store = makeStore()
    await store.createWork('テスト作')
    render(<Library store={store} onEnterEditor={() => {}} />)

    // 作品カードが見えている。まだゴミ箱ボタンは無い。
    expect(screen.getByText('テスト作')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ゴミ箱/ })).not.toBeInTheDocument()

    // 削除→確認ダイアログ「ゴミ箱へ移動」
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱へ移動' }))

    // カードが消え、ゴミ箱ボタン（件数つき）が出る
    await waitFor(() => expect(screen.queryByText('テスト作')).not.toBeInTheDocument())
    const trashButton = screen.getByRole('button', { name: /ゴミ箱/ })
    expect(trashButton).toBeInTheDocument()

    // ゴミ箱を開いて復元
    fireEvent.click(trashButton)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('テスト作')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '復元' }))

    // 復元され、グリッドに戻る／ゴミ箱ボタンは消える
    await waitFor(() => expect(screen.getByText('テスト作')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /ゴミ箱/ })).not.toBeInTheDocument()
  })

  it('ゴミ箱から完全に削除すると復元できなくなる', async () => {
    const store = makeStore()
    await store.createWork('消す作')
    render(<Library store={store} onEnterEditor={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱へ移動' }))
    await waitFor(() => expect(screen.queryByText('消す作')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ゴミ箱/ }))
    const dialog = await screen.findByRole('dialog')
    // 2段クリック確認：完全削除アイコン→「削除」
    fireEvent.click(within(dialog).getByRole('button', { name: /完全に削除/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }))

    await waitFor(() => expect(within(dialog).getByText('ゴミ箱は空です。')).toBeInTheDocument())
  })
})
