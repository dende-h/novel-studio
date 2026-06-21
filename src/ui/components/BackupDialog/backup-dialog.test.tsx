import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BackupDialog } from './backup-dialog'

describe('BackupDialog（全作品バックアップ）', () => {
  it('対象作品数と「執筆履歴は含まれない」境界を表示する', () => {
    render(<BackupDialog open onOpenChange={() => {}} workCount={3} onExport={() => {}} />)
    expect(screen.getByText('3作品')).toBeInTheDocument()
    expect(screen.getByText(/執筆履歴（版）は含まれません/)).toBeInTheDocument()
  })

  it('「書き出す」で onExport を呼び、完了表示に変わる', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<BackupDialog open onOpenChange={() => {}} workCount={2} onExport={onExport} />)
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('2作品をバックアップしました。')).toBeInTheDocument()
  })

  it('作品が 0 件のときは「書き出す」を無効化する', () => {
    render(<BackupDialog open onOpenChange={() => {}} workCount={0} onExport={() => {}} />)
    expect(screen.getByRole('button', { name: '書き出す' })).toBeDisabled()
  })
})
