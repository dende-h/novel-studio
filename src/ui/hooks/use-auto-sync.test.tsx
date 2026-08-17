import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorStore } from '@/ui/store/editorStore'
import type { SyncService } from '@/ui/sync/sync-service'
import { useAutoSync } from './use-auto-sync'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** subscribe だけ本物っぽく動く最小ストア（emit で変更を発火）。 */
function makeStore() {
  const listeners = new Set<() => void>()
  const store = {
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  } as unknown as EditorStore
  return {
    store,
    emit: () => {
      for (const l of listeners) l()
    },
  }
}

const makeService = () => {
  const reconcile = vi.fn(async () => null)
  const poll = vi.fn(async () => null)
  const service: SyncService = {
    reconcile,
    poll,
    subscribeSummary: () => () => {},
  }
  return { service, reconcile, poll }
}

describe('useAutoSync のトリガ', () => {
  it('マウント時に 1 回 完全 reconcile する（ログイン時の全体同期）', () => {
    const { store } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('store の変化は 5 秒 coalesce で 1 回の完全 reconcile にまとめる（push 目的）', () => {
    const { store, emit } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => emit())
    act(() => emit())
    act(() => vi.advanceTimersByTime(4_000))
    expect(reconcile).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('放置中は 15 秒ごとの軽量 poll で他端末の変更を拾う（本同期は世代が動いたときだけ）', () => {
    const { store } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => vi.advanceTimersByTime(15_000))
    expect(poll).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(15_000))
    expect(poll).toHaveBeenCalledTimes(2)
    expect(reconcile).not.toHaveBeenCalled() // 定期処理は poll 経由（軽量）
  })

  it('5 分に 1 回は世代チェックを飛ばした完全 reconcile で取り残しを回収する', () => {
    const { store } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(poll.mock.calls.length).toBeGreaterThan(0) // それまでは poll が回っている
  })

  it('非表示のタブでは定期 poll を走らせない', () => {
    const { store } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => vi.advanceTimersByTime(120_000))
    expect(poll).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('ウィンドウ focus で poll する（2 窓並びは visibilitychange が来ないため）', () => {
    const { store } = makeStore()
    const { service, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))

    // 定期 poll を止めるため非表示にし（focus 経路は visibility を見ない）、focus だけを検証する。
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => vi.advanceTimersByTime(10_000))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).not.toHaveBeenCalled() // 最小間隔（15 秒）未満は間引く
    act(() => vi.advanceTimersByTime(10_000))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).toHaveBeenCalledTimes(1) // 直後の連打は間引く
  })

  it('enabled=false では一切動かない（opt-in の維持）', () => {
    const { store, emit } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, false))
    act(() => emit())
    act(() => vi.advanceTimersByTime(600_000))
    expect(reconcile).not.toHaveBeenCalled()
    expect(poll).not.toHaveBeenCalled()
  })
})
