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
  const service: SyncService = {
    reconcile,
    subscribeSummary: () => () => {},
  }
  return { service, reconcile }
}

describe('useAutoSync のトリガ', () => {
  it('マウント時に 1 回 reconcile する（ログイン時の全体同期）', () => {
    const { store } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('store の変化は 30 秒 coalesce で 1 回にまとめて reconcile する', () => {
    const { store, emit } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    act(() => emit())
    act(() => emit())
    act(() => vi.advanceTimersByTime(29_000))
    expect(reconcile).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('放置中も 90 秒ごとの定期 reconcile で他端末の変更を拾う（受け側にトリガが無い問題の対策）', () => {
    const { store } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    // store 変化なし・visibility 変化なしでも、時間経過だけで pull が走る
    act(() => vi.advanceTimersByTime(90_000))
    expect(reconcile).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(90_000))
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('非表示のタブでは定期 reconcile を走らせない', () => {
    const { store } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => vi.advanceTimersByTime(300_000))
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('ウィンドウ focus で reconcile する（2 窓並びは visibilitychange が来ないため）', () => {
    const { store } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, true))
    reconcile.mockClear()

    // 最小間隔（60 秒）を過ぎてから focus → 発火
    act(() => vi.advanceTimersByTime(61_000))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(reconcile).toHaveBeenCalledTimes(1)

    // 直後の focus 連打は間引く
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('enabled=false では一切動かない（opt-in の維持）', () => {
    const { store, emit } = makeStore()
    const { service, reconcile } = makeService()
    renderHook(() => useAutoSync(store, service, false))
    act(() => emit())
    act(() => vi.advanceTimersByTime(300_000))
    expect(reconcile).not.toHaveBeenCalled()
  })
})
