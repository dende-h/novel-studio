import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reloadProofreadPrefs, useProofreadPrefs } from './use-proofread-prefs'

const KEY = 'ns-proofread-off'

describe('useProofreadPrefs', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY)
    reloadProofreadPrefs()
  })
  afterEach(() => {
    localStorage.removeItem(KEY)
    reloadProofreadPrefs()
  })

  it('既定はすべてオン（disabled が空）', () => {
    const { result } = renderHook(() => useProofreadPrefs())
    expect(result.current.disabled.size).toBe(0)
  })

  it('toggle でオフになり localStorage に配列で書かれ、もう一度でオンに戻る', () => {
    const { result } = renderHook(() => useProofreadPrefs())
    act(() => result.current.toggle('variant'))
    expect(result.current.disabled.has('variant')).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['variant'])
    act(() => result.current.toggle('variant'))
    expect(result.current.disabled.has('variant')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([])
  })

  it('toggle していなければ同じ Set 参照を返す（memo が効く）', () => {
    const { result, rerender } = renderHook(() => useProofreadPrefs())
    const first = result.current.disabled
    rerender()
    expect(result.current.disabled).toBe(first)
    act(() => result.current.toggle('indent'))
    expect(result.current.disabled).not.toBe(first)
  })

  it('壊れた値・未知の id・配列でない値はすべてオンとして扱い、例外を出さない', () => {
    localStorage.setItem(KEY, '{not json')
    reloadProofreadPrefs()
    expect(renderHook(() => useProofreadPrefs()).result.current.disabled.size).toBe(0)
    localStorage.setItem(KEY, JSON.stringify(['variant', 'unknown-rule', 42]))
    reloadProofreadPrefs()
    const { result } = renderHook(() => useProofreadPrefs())
    expect([...result.current.disabled]).toEqual(['variant'])
    localStorage.setItem(KEY, JSON.stringify({ variant: true }))
    reloadProofreadPrefs()
    expect(renderHook(() => useProofreadPrefs()).result.current.disabled.size).toBe(0)
  })
})
