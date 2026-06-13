import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHashRoute } from './use-hash-route'

beforeEach(() => {
  window.location.hash = ''
})

describe('useHashRoute（最小ハッシュルーティング）', () => {
  it('ハッシュ無しは "/"（LP）', () => {
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.route).toBe('/')
  })

  it('navigate でハッシュが変わり route も更新', () => {
    const { result } = renderHook(() => useHashRoute())
    act(() => result.current.navigate('/write'))
    expect(window.location.hash).toBe('#/write')
    expect(result.current.route).toBe('/write')
  })

  it('外部からの hashchange に追従', () => {
    const { result } = renderHook(() => useHashRoute())
    act(() => {
      window.location.hash = '#/write'
      window.dispatchEvent(new Event('hashchange'))
    })
    expect(result.current.route).toBe('/write')
  })
})
