import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NARROW_MAX_PX, NARROW_QUERY, useIsNarrow } from './use-narrow'

/** happy-dom はビューポート幅を実評価し resize で change を発火するため、振る舞いを直接テストできる。 */
function setWidth(width: number): void {
  // happyDOM は happy-dom 環境が注入する拡張で、標準の Window 型には無い。
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport: (v: { width: number }) => void }
  }
  act(() => {
    happyDOM.setViewport({ width })
  })
}

afterEach(() => {
  setWidth(1280)
})

describe('useIsNarrow', () => {
  // CSS(max-lg:) と JS の閾値がずれると「入口は消えたのにレイアウトは広いまま」等の
  // 不整合が起きる。Tailwind v4 は @theme の値を CSS 変数に出さず実行時に読めないため、
  // 二重管理はこの文字列 assert で検知する（片方だけ変えるとここが落ちる）。
  it('閾値は Tailwind の lg（1024px）と一致する', () => {
    expect(NARROW_MAX_PX).toBe(1024)
    expect(NARROW_QUERY).toBe('(max-width: 1023.98px)')
  })

  it('スマホ幅では true', () => {
    setWidth(390)
    const { result } = renderHook(() => useIsNarrow())
    expect(result.current).toBe(true)
  })

  it('デスクトップ幅では false', () => {
    setWidth(1280)
    const { result } = renderHook(() => useIsNarrow())
    expect(result.current).toBe(false)
  })

  it('境界: 1024px は false、1023px は true', () => {
    setWidth(1024)
    const { result } = renderHook(() => useIsNarrow())
    expect(result.current).toBe(false)
    setWidth(1023)
    expect(result.current).toBe(true)
  })

  it('リサイズ（回転）に追従する', () => {
    setWidth(1280)
    const { result } = renderHook(() => useIsNarrow())
    expect(result.current).toBe(false)
    setWidth(390)
    expect(result.current).toBe(true)
    setWidth(1280)
    expect(result.current).toBe(false)
  })
})
