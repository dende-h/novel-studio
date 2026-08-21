import { useEffect, useRef, useState } from 'react'
import { getSyncStatus, type SyncStatus, subscribeSyncStatus } from '@/ui/sync/sync-status'

/**
 * 同期表示の最小滞留時間。同期は 1 秒未満で終わることも多く、そのまま出すと
 * スピナーが点滅して逆に気になる。灯ったら最低これだけは灯し続ける。
 */
const MIN_VISIBLE_MS = 900

/**
 * ヘッダーの「同期中…」表示のための状態。ストアの生の値をそのまま返さず、
 * syncing の立ち下がりだけ MIN_VISIBLE_MS 遅らせて点滅を防ぐ（立ち上がりは即時）。
 */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus)
  const shownAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const apply = () => {
      const next = getSyncStatus()
      setStatus((prev) => {
        if (next.syncing && !prev.syncing) shownAt.current = Date.now()
        if (!next.syncing && prev.syncing) {
          const rest = MIN_VISIBLE_MS - (Date.now() - shownAt.current)
          if (rest > 0) {
            clear()
            timer.current = setTimeout(apply, rest)
            return { ...next, syncing: true } // まだ消さない（点滅防止）
          }
        }
        return next
      })
    }
    const unsub = subscribeSyncStatus(apply)
    apply() // 購読の前に変わっていた場合の取りこぼしを拾う
    return () => {
      unsub()
      clear()
    }
  }, [])

  return status
}
