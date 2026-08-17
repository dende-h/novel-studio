import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupService, BackupSummary } from '@/ui/backup/backup-service'
import type { EditorStore } from '@/ui/store/editorStore'
import { useAutoBackup } from './use-auto-backup'
import { markCloudBackup, readBackupMarks } from './use-backup-marks'

const IDLE_MS = 5 * 60_000
const MIN_INTERVAL_MS = 60 * 60_000

beforeEach(() => {
  vi.useFakeTimers()
  // use-backup-marks はモジュール状態を持つので、毎回「十分昔」に正規化して間隔条件を通す。
  markCloudBackup(0)
})
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

/** backupNow の戻り値を差し替えられる最小サービス（null=失敗）。 */
const makeService = (
  result: () => BackupSummary | null = () => ({ id: 'b1', createdAt: 0, size: 1 }),
) => {
  const backupNow = vi.fn(async () => result())
  return { service: { backupNow } as unknown as BackupService, backupNow }
}

describe('useAutoBackup', () => {
  it('編集静止 5 分で 1 回だけ backupNow し、成功時に markCloudBackup する', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    renderHook(() => useAutoBackup(store, service, true))

    act(() => emit())
    act(() => emit())
    expect(backupNow).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS)
    })
    expect(backupNow).toHaveBeenCalledTimes(1)
    expect(readBackupMarks().cloudBackupAt).toBe(Date.now())
  })

  it('前回クラウドバックアップから 60 分未満なら送らない（次の編集静止で再判定）', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    renderHook(() => useAutoBackup(store, service, true))

    markCloudBackup(Date.now()) // 手動バックアップ直後を再現
    act(() => emit())
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS)
    })
    expect(backupNow).not.toHaveBeenCalled()

    // 静止したままでは発火しない（タイマーは消費済み・dirty 維持）
    await act(async () => {
      vi.advanceTimersByTime(MIN_INTERVAL_MS)
    })
    expect(backupNow).not.toHaveBeenCalled()

    // 間隔経過後の次の編集静止で送られる
    act(() => emit())
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS)
    })
    expect(backupNow).toHaveBeenCalledTimes(1)
  })

  it('タブが隠れると間隔条件を満たす限り即 flush する', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    renderHook(() => useAutoBackup(store, service, true))

    act(() => emit())
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(backupNow).toHaveBeenCalledTimes(1)
  })

  it('タブが隠れても 60 分未満なら送らない', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    renderHook(() => useAutoBackup(store, service, true))

    markCloudBackup(Date.now())
    act(() => emit())
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(backupNow).not.toHaveBeenCalled()
  })

  it('アンマウント時に未送信分を flush する', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    const { unmount } = renderHook(() => useAutoBackup(store, service, true))
    act(() => emit())
    await act(async () => {
      unmount()
    })
    expect(backupNow).toHaveBeenCalledTimes(1)
  })

  it('失敗（null）時は markCloudBackup せず dirty 維持で次の静止に再試行する', async () => {
    const { store, emit } = makeStore()
    let ok = false
    const { service, backupNow } = makeService(() =>
      ok ? { id: 'b1', createdAt: 0, size: 1 } : null,
    )
    renderHook(() => useAutoBackup(store, service, true))

    act(() => emit())
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS)
    })
    expect(backupNow).toHaveBeenCalledTimes(1)
    expect(readBackupMarks().cloudBackupAt).toBe(0) // 失敗＝記録しない

    // dirty が残っているので次の編集静止で再試行し、成功で記録される
    ok = true
    act(() => emit())
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS)
    })
    expect(backupNow).toHaveBeenCalledTimes(2)
    expect(readBackupMarks().cloudBackupAt).toBe(Date.now())
  })

  it('enabled=false では一切バックアップしない', async () => {
    const { store, emit } = makeStore()
    const { service, backupNow } = makeService()
    renderHook(() => useAutoBackup(store, service, false))
    act(() => emit())
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS * 2)
    })
    expect(backupNow).not.toHaveBeenCalled()
  })
})
