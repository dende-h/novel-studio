import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishSyncStatus, resetSyncStatus } from '@/ui/sync/sync-status'
import { useSyncStatus } from './use-sync-status'

beforeEach(() => {
  vi.useFakeTimers()
  resetSyncStatus()
})
afterEach(() => {
  vi.useRealTimers()
  resetSyncStatus()
})

describe('useSyncStatus（ヘッダーの同期表示）', () => {
  it('同期の開始は即座に反映する', () => {
    const { result } = renderHook(() => useSyncStatus())
    act(() => publishSyncStatus({ enabled: true, syncing: true }))
    expect(result.current.syncing).toBe(true)
  })

  it('すぐ終わっても最低 900ms は灯し続ける（点滅させない）', () => {
    const { result } = renderHook(() => useSyncStatus())
    act(() => publishSyncStatus({ enabled: true, syncing: true }))
    act(() => {
      vi.advanceTimersByTime(100)
      publishSyncStatus({ syncing: false })
    })
    expect(result.current.syncing).toBe(true) // まだ消さない
    act(() => vi.advanceTimersByTime(900))
    expect(result.current.syncing).toBe(false)
  })

  it('十分に長い同期はそのまま消える', () => {
    const { result } = renderHook(() => useSyncStatus())
    act(() => publishSyncStatus({ enabled: true, syncing: true }))
    act(() => {
      vi.advanceTimersByTime(2_000)
      publishSyncStatus({ syncing: false })
    })
    expect(result.current.syncing).toBe(false)
  })

  it('非会員（enabled=false）では表示に使う値も立たない', () => {
    const { result } = renderHook(() => useSyncStatus())
    expect(result.current).toEqual({ enabled: false, syncing: false, lastSyncedAt: null })
  })
})
