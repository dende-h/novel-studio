import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupService } from '@/ui/backup/backup-service'
import type { EditorStore } from '@/ui/store/editorStore'
import { useLiveSnapshot } from './use-live-snapshot'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

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
  const pushLive = vi.fn(async () => {})
  return { service: { pushLive } as unknown as BackupService, pushLive }
}

describe('useLiveSnapshot', () => {
  it('編集後、静止で 1 回だけ pushLive する（デバウンス）', () => {
    const { store, emit } = makeStore()
    const { service, pushLive } = makeService()
    renderHook(() => useLiveSnapshot(store, service, true))

    act(() => emit())
    act(() => emit())
    expect(pushLive).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(4000))
    expect(pushLive).toHaveBeenCalledTimes(1)
  })

  it('enabled=false では一切 push しない（オプトインした人だけ上げる）', () => {
    const { store, emit } = makeStore()
    const { service, pushLive } = makeService()
    renderHook(() => useLiveSnapshot(store, service, false))
    act(() => emit())
    act(() => vi.advanceTimersByTime(10000))
    expect(pushLive).not.toHaveBeenCalled()
  })

  it('タブが隠れると未送信分を即 flush する', () => {
    const { store, emit } = makeStore()
    const { service, pushLive } = makeService()
    renderHook(() => useLiveSnapshot(store, service, true))

    act(() => emit())
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(pushLive).toHaveBeenCalledTimes(1)
  })

  it('無効化（アンマウント）時に未送信分を flush する', () => {
    const { store, emit } = makeStore()
    const { service, pushLive } = makeService()
    const { unmount } = renderHook(() => useLiveSnapshot(store, service, true))
    act(() => emit())
    unmount()
    expect(pushLive).toHaveBeenCalledTimes(1)
  })
})
