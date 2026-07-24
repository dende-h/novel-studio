import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog（破壊操作の確認）', () => {
  it('タイトルと説明を表示する', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="削除しますか？"
        description="この操作は取り消せません"
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('削除しますか？')).toBeInTheDocument()
    expect(screen.getByText('この操作は取り消せません')).toBeInTheDocument()
  })

  it('確定ボタンで onConfirm と onOpenChange(false) を呼ぶ', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="削除"
        confirmLabel="削除する"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('キャンセルでは onConfirm を呼ばずに閉じる', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="削除" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
