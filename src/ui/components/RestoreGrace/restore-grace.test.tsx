import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileRepository } from '@/core/profile'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { ActivityRepository } from '@/core/storage/activityRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { WorkRepository } from '@/core/storage/workRepository'
import { Library } from '@/ui/components/Library/library'
import { createEditorStore } from '@/ui/store/editorStore'
import { RestoreGrace } from './restore-grace'

vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))

const DAY = 86_400_000

describe('RestoreGrace（解約後の復元猶予の案内）', () => {
  it('残り日数と、復元・書き出し・再開の導線を出す', () => {
    const onRestore = vi.fn()
    const onExport = vi.fn()
    const onResume = vi.fn()
    render(
      <RestoreGrace
        graceUntil={Date.now() + 27 * DAY - 1000}
        onRestore={onRestore}
        onExport={onExport}
        onResume={onResume}
      />,
    )
    expect(screen.getByText('あと 27 日')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'クラウドから復元' }))
    fireEvent.click(screen.getByRole('button', { name: 'ファイルに書き出す' }))
    fireEvent.click(screen.getByRole('button', { name: 'クラウド版を再開' }))
    expect(onRestore).toHaveBeenCalledOnce()
    expect(onExport).toHaveBeenCalledOnce()
    expect(onResume).toHaveBeenCalledOnce()
  })

  // 回帰：かつては全画面でアプリを塞ぎ、解約した人だけ無料アカウントとして使えなかった。
  it('ライブラリの中に出て、作品一覧はそのまま使える', async () => {
    const kv = new MemoryStore()
    let n = 0
    const store = createEditorStore({
      repo: new WorkRepository(kv),
      snapshotRepo: new SnapshotRepository(kv),
      profileRepo: new ProfileRepository(kv),
      activityRepo: new ActivityRepository(kv),
      genId: () => `id${++n}`,
      now: () => Date.now(),
      snapshotMinIntervalMs: 0,
      trashTtlMs: Number.MAX_SAFE_INTEGER,
    })
    await store.createWork('手元の原稿')
    render(
      <Library
        store={store}
        onEnterEditor={() => {}}
        onEnterPublish={() => {}}
        localBackup={{ exportPlaintext: async () => '{}', restorePlaintext: async () => {} }}
        isMember={false}
        onboarded={false}
        activityRepo={new ActivityRepository(new MemoryStore())}
        notice={
          <RestoreGrace
            graceUntil={Date.now() + 3 * DAY}
            onRestore={() => {}}
            onExport={() => {}}
          />
        }
      />,
    )
    expect(screen.getByRole('region', { name: 'クラウドのデータの削除予定' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '手元の原稿' })).toBeInTheDocument()
  })
})
