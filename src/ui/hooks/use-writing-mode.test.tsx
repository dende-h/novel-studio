import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWritingMode } from './use-writing-mode'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperties(document, {
    fullscreenElement: { configurable: true, get: () => null },
    fullscreenEnabled: { configurable: true, get: () => false },
    exitFullscreen: { configurable: true, value: async () => {}, writable: true },
  })
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: async () => {},
    writable: true,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('執筆モード', () => {
  it('設定を両方向に保存し、適用できない画面では集中を適用しない', () => {
    const { result, rerender, unmount } = renderHook(({ eligible }) => useWritingMode(eligible), {
      initialProps: { eligible: true },
    })
    expect(result.current.focus).toBe(false)
    act(() => result.current.toggleFocus())
    expect(localStorage.getItem('ns-writing-focus')).toBe('1')
    rerender({ eligible: false })
    expect(result.current.focus).toBe(false)
    rerender({ eligible: true })
    expect(result.current.focus).toBe(true)
    act(() => result.current.toggleFocus())
    expect(localStorage.getItem('ns-writing-focus')).toBe('0')
    act(() => result.current.toggleTypewriter())
    unmount()
    expect(renderHook(() => useWritingMode(true)).result.current.typewriter).toBe(true)
  })

  it('repeat・IME・dialog・処理済みのキーを奪わない', () => {
    const { result } = renderHook(() => useWritingMode(true))
    const key = { key: 'F', code: 'KeyF', altKey: true, shiftKey: true }
    fireEvent.keyDown(document, { ...key, repeat: true })
    fireEvent.compositionStart(document)
    fireEvent.keyDown(document, key)
    fireEvent.compositionEnd(document)
    fireEvent.keyDown(document, { ...key, isComposing: true })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(document, key)
    dialog.remove()
    const event = new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true })
    event.preventDefault()
    fireEvent(document, event)
    expect(result.current.focus).toBe(false)
    fireEvent.keyDown(document, key)
    expect(result.current.focus).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(result.current.focus).toBe(true)
  })

  it('localStorageが使えなくても現在の切替は動作する', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked')
    })
    const { result } = renderHook(() => useWritingMode(true))
    act(() => result.current.toggleFocus())
    expect(result.current.focus).toBe(true)
    act(() => result.current.toggleFocus())
    expect(result.current.focus).toBe(false)
  })

  it('全画面の拒否・外部終了・自分が開始した全画面だけの終了を扱う', async () => {
    let element: Element | null = null
    vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => element)
    vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true)
    const request = vi
      .spyOn(document.documentElement, 'requestFullscreen')
      .mockRejectedValueOnce(Error('denied'))
      .mockImplementation(async () => {
        element = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      })
    const exit = vi.spyOn(document, 'exitFullscreen').mockImplementation(async () => {
      element = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const { result } = renderHook(() => useWritingMode(true))
    act(() => result.current.toggleFocus())
    await act(() => result.current.toggleFullscreen())
    expect(result.current.focus).toBe(true)
    expect(result.current.fullscreen).toBe(false)
    await act(() => result.current.toggleFullscreen())
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current.fullscreen).toBe(true)
    act(() => {
      element = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.fullscreen).toBe(false)
    act(() => {
      element = document.documentElement
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    act(() => result.current.toggleFocus())
    expect(exit).not.toHaveBeenCalled()
  })
})

it('自分が開始した全画面を集中終了時に解除する', async () => {
  let element: Element | null = null
  vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => element)
  vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true)
  vi.spyOn(document.documentElement, 'requestFullscreen').mockImplementation(async () => {
    element = document.documentElement
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  const exit = vi.spyOn(document, 'exitFullscreen').mockImplementation(async () => {
    element = null
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  const { result } = renderHook(() => useWritingMode(true))
  act(() => result.current.toggleFocus())
  await act(() => result.current.toggleFullscreen())
  expect(result.current.fullscreenAvailable).toBe(true)
  await act(() => result.current.toggleFocus())
  expect(exit).toHaveBeenCalledOnce()
  expect(result.current.fullscreen).toBe(false)
})

it('全画面の開始待ちの間に画面を離れたら、遅れて成功しても解除する', async () => {
  let element: Element | null = null
  let finish = () => {}
  vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => element)
  vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true)
  vi.spyOn(document.documentElement, 'requestFullscreen').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          element = document.documentElement
          resolve()
        }
      }),
  )
  const exit = vi.spyOn(document, 'exitFullscreen').mockResolvedValue()
  const { result, unmount } = renderHook(() => useWritingMode(true))
  act(() => result.current.toggleFocus())
  let request: Promise<void>
  act(() => {
    request = result.current.toggleFullscreen()
  })
  unmount()
  await act(async () => {
    finish()
    await request
  })
  expect(exit).toHaveBeenCalledOnce()
})
