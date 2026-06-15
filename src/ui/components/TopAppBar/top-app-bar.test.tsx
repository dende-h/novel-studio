import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopAppBar } from './top-app-bar'

describe('TopAppBar（トップバー）', () => {
  it('onToggleHistory 指定時は履歴トグルを表示し、クリックで発火する', () => {
    const onToggleHistory = vi.fn()
    render(<TopAppBar onToggleHistory={onToggleHistory} historyOpen={false} />)
    const btn = screen.getByRole('button', { name: '履歴' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(onToggleHistory).toHaveBeenCalledTimes(1)
  })

  it('historyOpen=true のとき aria-pressed=true', () => {
    render(<TopAppBar onToggleHistory={() => {}} historyOpen />)
    expect(screen.getByRole('button', { name: '履歴' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('onToggleHistory 未指定なら履歴トグルを出さない', () => {
    render(<TopAppBar />)
    expect(screen.queryByRole('button', { name: '履歴' })).toBeNull()
  })
})
