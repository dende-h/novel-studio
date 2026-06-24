import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './toast'

describe('Toast（最小トースト機構）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ToastProvider>{children}</ToastProvider>
  )

  it('show でメッセージを表示し、一定時間後に消える', () => {
    const { result } = renderHook(() => useToast(), { wrapper })
    act(() => result.current.show('別の端末でログインされたためサインアウトしました'))
    expect(screen.getByText('別の端末でログインされたためサインアウトしました')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(6000))
    expect(screen.queryByText('別の端末でログインされたためサインアウトしました')).toBeNull()
  })

  it('プロバイダ未設定でも show は no-op で例外を投げない', () => {
    render(<NoProvider />)
    // 例外なく描画できれば合格（フォールバック no-op）。
    expect(screen.getByTestId('no-provider')).toBeInTheDocument()
  })
})

function NoProvider() {
  const { show } = useToast()
  show('ignored')
  return <div data-testid="no-provider" />
}
