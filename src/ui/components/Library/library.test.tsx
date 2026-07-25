import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileRepository } from '@/core/profile'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { ActivityRepository } from '@/core/storage/activityRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { WorkRepository } from '@/core/storage/workRepository'
import type { LocalBackupService } from '@/ui/backup/backup-service'
import { createEditorStore, type EditorStore } from '@/ui/store/editorStore'
import { Library } from './library'

const makeStore = (): EditorStore => {
  let n = 0
  const kv = new MemoryStore()
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

/** ローカルバックアップは本テストの対象外なので no-op を渡す。 */
const fakeLocalBackup: LocalBackupService = {
  exportPlaintext: async () => '{}',
  restorePlaintext: async () => {},
}

// バックアップ案内（タスク4）は onboarded=false で無効化して既存テストに干渉させない。
const fakeActivityRepo = new ActivityRepository(new MemoryStore())

// 表示切替（カード／リスト）は localStorage に記憶されるのでテスト間で隔離する
beforeEach(() => {
  localStorage.clear()
})

describe('Library 作成・表示', () => {
  it('「作成」してもエディタへ遷移せず、一覧に作品が増える', async () => {
    const store = makeStore()
    const onEnter = vi.fn()
    render(
      <Library
        store={store}
        onEnterEditor={onEnter}
        localBackup={fakeLocalBackup}
        isMember={false}
        onboarded={false}
        activityRepo={fakeActivityRepo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新規プロジェクト/ }))
    const input = await screen.findByLabelText('作品タイトル')
    fireEvent.change(input, { target: { value: '新しい物語' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(await screen.findByRole('heading', { name: '新しい物語' })).toBeInTheDocument()
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('リスト表示に切り替えても作品が出て、執筆で遷移する', async () => {
    const store = makeStore()
    await store.createWork('一覧作')
    const onEnter = vi.fn()
    render(
      <Library
        store={store}
        onEnterEditor={onEnter}
        localBackup={fakeLocalBackup}
        isMember={false}
        onboarded={false}
        activityRepo={fakeActivityRepo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'リスト表示' }))
    expect(screen.getByRole('heading', { name: '一覧作' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '執筆' }))
    await waitFor(() => expect(onEnter).toHaveBeenCalled())
  })
})

describe('Library 作品名検索', () => {
  it('タイトル部分一致で絞り込み、不一致は空メッセージを出す', async () => {
    const store = makeStore()
    await store.createWork('静謐の森')
    await store.createWork('春の列車')
    render(
      <Library
        store={store}
        onEnterEditor={() => {}}
        localBackup={fakeLocalBackup}
        isMember={false}
        onboarded={false}
        activityRepo={fakeActivityRepo}
      />,
    )
    expect(await screen.findByRole('heading', { name: '静謐の森' })).toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: '作品名で検索' })
    fireEvent.change(search, { target: { value: '列車' } })
    expect(screen.getByRole('heading', { name: '春の列車' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '静謐の森' })).toBeNull()

    fireEvent.change(search, { target: { value: '存在しない題名' } })
    expect(screen.getByText(/「存在しない題名」に一致する作品がありません/)).toBeInTheDocument()

    // 空に戻すと全件表示
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('heading', { name: '静謐の森' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '春の列車' })).toBeInTheDocument()
  })
})

describe('Library ゴミ箱導線', () => {
  it('削除→ゴミ箱へ移動→復元 が UI で一周する', async () => {
    const store = makeStore()
    await store.createWork('テスト作')
    render(
      <Library
        store={store}
        onEnterEditor={() => {}}
        localBackup={fakeLocalBackup}
        isMember={false}
        onboarded={false}
        activityRepo={fakeActivityRepo}
      />,
    )

    // 作品カードが見えている。まだゴミ箱ボタンは無い。
    expect(screen.getByRole('heading', { name: 'テスト作' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ゴミ箱/ })).not.toBeInTheDocument()

    // ケバブメニュー→「ゴミ箱へ移動」→確認ダイアログ「ゴミ箱へ移動」
    fireEvent.click(screen.getByRole('button', { name: '「テスト作」のメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'ゴミ箱へ移動' }))
    fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱へ移動' }))

    // カードが消え、ゴミ箱ボタン（件数つき）が出る
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'テスト作' })).toBeNull())
    const trashButton = screen.getByRole('button', { name: /ゴミ箱/ })
    expect(trashButton).toBeInTheDocument()

    // ゴミ箱を開いて復元
    fireEvent.click(trashButton)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('テスト作')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '復元' }))

    // 復元され、グリッドに戻る（ダイアログ表示中は背景が aria-hidden なので hidden も探す）
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'テスト作', hidden: true })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /ゴミ箱/ })).not.toBeInTheDocument()
  })

  it('ゴミ箱から完全に削除すると復元できなくなる', async () => {
    const store = makeStore()
    await store.createWork('消す作')
    render(
      <Library
        store={store}
        onEnterEditor={() => {}}
        localBackup={fakeLocalBackup}
        isMember={false}
        onboarded={false}
        activityRepo={fakeActivityRepo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '「消す作」のメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'ゴミ箱へ移動' }))
    fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱へ移動' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '消す作' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /ゴミ箱/ }))
    const dialog = await screen.findByRole('dialog')
    // 2段クリック確認：完全削除アイコン→「削除」
    fireEvent.click(within(dialog).getByRole('button', { name: /完全に削除/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }))

    await waitFor(() => expect(within(dialog).getByText('ゴミ箱は空です。')).toBeInTheDocument())
  })
})
