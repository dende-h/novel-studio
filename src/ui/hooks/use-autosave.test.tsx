import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutosave } from './use-autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutosave（debounced 自動保存）', () => {
  it('dirty かつ静止 delay 経過で save を1回呼ぶ', () => {
    const save = vi.fn()
    renderHook(() => useAutosave('draft', true, save, 800))
    expect(save).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(800))
    expect(save).toHaveBeenCalledOnce()
  })

  it('連続入力中は保存せず、静止後にまとめて1回', () => {
    const save = vi.fn()
    const { rerender } = renderHook(({ d }) => useAutosave(d, true, save, 800), {
      initialProps: { d: 'あ' },
    })
    act(() => vi.advanceTimersByTime(500))
    rerender({ d: 'あい' })
    act(() => vi.advanceTimersByTime(500))
    rerender({ d: 'あいう' })
    expect(save).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(800))
    expect(save).toHaveBeenCalledOnce()
  })

  it('dirty=false なら保存しない', () => {
    const save = vi.fn()
    renderHook(() => useAutosave('draft', false, save, 800))
    act(() => vi.advanceTimersByTime(2000))
    expect(save).not.toHaveBeenCalled()
  })
})
