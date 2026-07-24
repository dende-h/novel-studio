import { useEffect, useRef } from 'react'
import type { BackupService } from '@/ui/backup/backup-service'
import type { EditorStore } from '@/ui/store/editorStore'

/** 編集が止まってからライブスナップショットへ送るまでの猶予（過剰アップロードを抑える）。 */
const DEBOUNCE_MS = 4000

/**
 * MCP を接続済みの会員に限り、編集をデバウンスしてライブスナップショットへ片方向 push する。
 * AI が「最新の作品」を読めるようにするための上書き保存（版は作らない・PUT /api/backup）。
 * タブが隠れる/離脱する直前と、無効化・アンマウント時に未送信分を flush して取りこぼしを防ぐ。
 *
 * enabled=false（未接続 or 非会員）では一切 push しない＝オプトインした人のデータだけが上がる。
 */
export function useLiveSnapshot(
  store: EditorStore,
  service: BackupService | null,
  enabled: boolean,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  useEffect(() => {
    if (!service || !enabled) return

    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const flush = () => {
      if (!dirty.current) return
      dirty.current = false
      clear()
      void service.pushLive()
    }
    const schedule = () => {
      dirty.current = true
      clear()
      timer.current = setTimeout(flush, DEBOUNCE_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    const unsub = store.subscribe(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)

    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush() // 無効化/アンマウント時にも未送信分を送る
      clear()
    }
  }, [store, service, enabled])
}
