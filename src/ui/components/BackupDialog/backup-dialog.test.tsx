import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BackupDialog } from './backup-dialog'

describe('BackupDialog（全体バックアップ）', () => {
  it('対象データと「執筆履歴は含まれない」境界を表示する', () => {
    render(<BackupDialog open onOpenChange={() => {}} workCount={3} onExport={() => {}} />)
    expect(screen.getByText('すべてのデータ')).toBeInTheDocument()
    expect(screen.getByText(/執筆履歴（版）は含まれません/)).toBeInTheDocument()
  })

  it('「書き出す」で onExport を呼び、完了表示に変わる', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<BackupDialog open onOpenChange={() => {}} workCount={2} onExport={onExport} />)
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('すべてのデータをバックアップしました。')).toBeInTheDocument()
  })

  it('作品が 0 件でも全データ対象なので「書き出す」は有効', () => {
    render(<BackupDialog open onOpenChange={() => {}} workCount={0} onExport={() => {}} />)
    expect(screen.getByRole('button', { name: '書き出す' })).toBeEnabled()
  })
})
