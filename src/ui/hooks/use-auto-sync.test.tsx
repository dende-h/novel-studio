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

  it('store の変化は 1.5 秒 coalesce で 1 回の完全 reconcile にまとめる（push 目的）', () => {
    const { store, emit } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => emit())
    act(() => emit())
    act(() => vi.advanceTimersByTime(1_000))
    expect(reconcile).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('開いた直後 30 秒は 5 秒間隔でバースト poll し、その後は 10 秒間隔に落ち着く', () => {
    const { store } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => vi.advanceTimersByTime(25_000)) // t=5..25 で 5 回（バースト中）
    expect(poll).toHaveBeenCalledTimes(5)
    act(() => vi.advanceTimersByTime(5_000)) // t=30：バースト終了・前回から 5 秒 → 間引く
    expect(poll).toHaveBeenCalledTimes(5)
    act(() => vi.advanceTimersByTime(5_000)) // t=35：前回から 10 秒 → poll
    expect(poll).toHaveBeenCalledTimes(6)
    act(() => vi.advanceTimersByTime(5_000)) // t=40：5 秒 → 間引く
    expect(poll).toHaveBeenCalledTimes(6)
    act(() => vi.advanceTimersByTime(5_000)) // t=45：10 秒 → poll
    expect(poll).toHaveBeenCalledTimes(7)
    expect(reconcile).not.toHaveBeenCalled() // 定期処理は poll 経由（軽量）
  })

  it('5 分に 1 回は世代チェックを飛ばした完全 reconcile で取り残しを回収する', () => {
    const { store } = makeStore()
    const { service, reconcile, poll } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => vi.advanceTimersByTime(5 * 60_000 + 5_000))
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
    act(() => vi.advanceTimersByTime(3_000))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).not.toHaveBeenCalled() // 最小間隔（5 秒）未満は間引く
    act(() => vi.advanceTimersByTime(3_000))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(poll).toHaveBeenCalledTimes(1) // 直後の連打は間引く
  })

  it('画面遷移（attentionKey の変化）で即 poll し、バーストを張り直す', () => {
    const { store } = makeStore()
    const { service, poll } = makeService()
    // 定期 poll を止めて遷移経路だけを検証する（遷移は表示中にしか起きない）。
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { rerender } = renderHook(({ route }) => useAutoSync(store, service, true, {}, route), {
      initialProps: { route: '/' },
    })
    expect(poll).not.toHaveBeenCalled() // マウント直後は run() 直後なので間引かれる

    act(() => vi.advanceTimersByTime(6_000))
    rerender({ route: '/ideas' })
    expect(poll).toHaveBeenCalledTimes(1) // 間が空いていれば遷移で即 poll
    rerender({ route: '/write' })
    expect(poll).toHaveBeenCalledTimes(1) // 直後の連続遷移は間引く
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
