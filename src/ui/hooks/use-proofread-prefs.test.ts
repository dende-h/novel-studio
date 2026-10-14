import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reloadProofreadPrefs, useProofreadPrefs } from './use-proofread-prefs'

const KEY = 'ns-proofread-on'
const OLD_KEY = 'ns-proofread-off'

describe('useProofreadPrefs（選んだ項目・COT-40）', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY)
    localStorage.removeItem(OLD_KEY)
    reloadProofreadPrefs()
  })
  afterEach(() => {
    localStorage.removeItem(KEY)
    localStorage.removeItem(OLD_KEY)
    reloadProofreadPrefs()
  })

  it('最初は何も選ばれていない（enabled が空）', () => {
    const { result } = renderHook(() => useProofreadPrefs())
    expect(result.current.enabled.size).toBe(0)
  })

  it('toggle で選ばれ localStorage に配列で書かれ、もう一度で外れる', () => {
    const { result } = renderHook(() => useProofreadPrefs())
    act(() => result.current.toggle('variant'))
    expect(result.current.enabled.has('variant')).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['variant'])
    act(() => result.current.toggle('variant'))
    expect(result.current.enabled.has('variant')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([])
  })

  it('toggle していなければ同じ Set 参照を返す（memo が効く）', () => {
    const { result, rerender } = renderHook(() => useProofreadPrefs())
    const first = result.current.enabled
    rerender()
    expect(result.current.enabled).toBe(first)
    act(() => result.current.toggle('indent'))
    expect(result.current.enabled).not.toBe(first)
  })

  it('壊れた値・未知の id・配列でない値は何も選ばれていない扱いにし、例外を出さない', () => {
    localStorage.setItem(KEY, '{not json')
    reloadProofreadPrefs()
    expect(renderHook(() => useProofreadPrefs()).result.current.enabled.size).toBe(0)
    localStorage.setItem(KEY, JSON.stringify(['variant', 'unknown-rule', 42]))
    reloadProofreadPrefs()
    const { result } = renderHook(() => useProofreadPrefs())
    expect([...result.current.enabled]).toEqual(['variant'])
    localStorage.setItem(KEY, JSON.stringify({ variant: true }))
    reloadProofreadPrefs()
    expect(renderHook(() => useProofreadPrefs()).result.current.enabled.size).toBe(0)
  })

  it('旧キー（COT-30 の「オフにした項目」）は読まない', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify(['indent']))
    reloadProofreadPrefs()
    expect(renderHook(() => useProofreadPrefs()).result.current.enabled.size).toBe(0)
  })
})
