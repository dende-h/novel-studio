import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BackupService } from '@/ui/backup/backup-service'
import { CloudBackupDialog } from './cloud-backup-dialog'

const makeService = (order: string[]): BackupService => ({
  backupNow: vi.fn(async () => null),
  list: vi.fn(async () => [{ id: 'b1', createdAt: Date.UTC(2026, 9, 1), size: 1 }]),
  restore: vi.fn(async () => {
    order.push('restore')
    return true
  }),
  remove: vi.fn(async () => true),
  pushLive: vi.fn(async () => 'ok' as const),
  liveInfo: vi.fn(async () => null),
  pullLive: vi.fn(async () => true),
})

const restoreFirstBackup = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '復元' }))
  fireEvent.click(screen.getByRole('button', { name: '復元する' }))
}

describe('CloudBackupDialog（解約後の猶予期間の復元）', () => {
  it('置き換える前に、いまの端末のデータを書き出してから復元する', async () => {
    const order: string[] = []
    const service = makeService(order)
    const onRestored = vi.fn()
    render(
      <CloudBackupDialog
        open
        onOpenChange={() => {}}
        service={service}
        onNotify={() => {}}
        onRestored={onRestored}
        restoreOnly
        beforeRestore={async () => {
          order.push('export')
        }}
      />,
    )
    expect(screen.getByText(/自動でファイルに書き出します/)).toBeInTheDocument()
    await restoreFirstBackup()
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    expect(order).toEqual(['export', 'restore'])
  })

  it('書き出せなかったら復元しない', async () => {
    const service = makeService([])
    const onNotify = vi.fn()
    render(
      <CloudBackupDialog
        open
        onOpenChange={() => {}}
        service={service}
        onNotify={onNotify}
        onRestored={() => {}}
        restoreOnly
        beforeRestore={async () => {
          throw new Error('disk full')
        }}
      />,
    )
    await restoreFirstBackup()
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        'いまのデータを書き出せなかったため、復元を中止しました',
      ),
    )
    expect(service.restore).not.toHaveBeenCalled()
  })
})
