import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TopAppBar } from './top-app-bar'

beforeEach(() => localStorage.removeItem('ns-narration-entry-seen'))

it('朗読の入口がある場合に案内を出し、閉じると再表示しない', () => {
  const open = vi.fn()
  const view = render(<TopAppBar />)
  expect(screen.queryByText('原稿から朗読を作る')).toBeNull()
  view.rerender(<TopAppBar onNarration={open} />)
  expect(screen.getByText('原稿から朗読を作る')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '朗読制作の案内を閉じる' }))
  expect(open).not.toHaveBeenCalled()
  view.unmount()
  render(<TopAppBar onNarration={open} />)
  expect(screen.queryByText('原稿から朗読を作る')).toBeNull()
  expect(screen.getByRole('button', { name: '朗読制作' })).toBeVisible()
})

it('朗読制作を開く操作でも案内を閉じる', () => {
  const open = vi.fn()
  render(<TopAppBar onNarration={open} />)
  fireEvent.click(screen.getByRole('button', { name: '朗読制作' }))
  expect(open).toHaveBeenCalledOnce()
  expect(screen.queryByText('原稿から朗読を作る')).toBeNull()
})
