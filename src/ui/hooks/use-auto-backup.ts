import { useEffect, useRef } from 'react'
import type { BackupService } from '@/ui/backup/backup-service'
import { markCloudBackup, readBackupMarks } from '@/ui/hooks/use-backup-marks'
import type { EditorStore } from '@/ui/store/editorStore'

/** 編集が止まってから自動バックアップを試みるまでの静止時間（執筆の邪魔をしない）。 */
const IDLE_MS = 5 * 60_000

/** 前回クラウドバックアップからの最小間隔（世代の浪費と過剰アップロードを抑える）。 */
const MIN_INTERVAL_MS = 60 * 60_000

/**
 * 会員に限り、編集静止後に全体クラウドバックアップ（版あり・POST /api/backup）を自動で取る。
 * use-live-snapshot と同型の購読・flush 構造だが、こちらは版を作るため間隔を広く取る：
 * 静止 5 分で発火し、前回クラウドバックアップ（readBackupMarks）から 60 分未満なら送らず
 * 次の編集静止でまた判定する。手動バックアップが間に走った場合も同じ記録を見てスキップされる。
 *
 * 失敗（オフライン等）は黙って無視し、dirty を維持して次の機会に再試行する。
 * 成功時のみ markCloudBackup で記録し dirty を下ろす。
 * タブが隠れる/離脱する直前と、無効化・アンマウント時にも条件を満たせば fire-and-forget で送る。
 */
export function useAutoBackup(
  store: EditorStore,
  service: BackupService | null,
  enabled: boolean,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const sending = useRef(false)

  useEffect(() => {
    if (!service || !enabled) return

    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const flush = () => {
      clear()
      if (!dirty.current || sending.current) return
      // 間隔判定は送信直前に毎回読む（手動バックアップが間に走った場合も正しくスキップする）。
      const { cloudBackupAt } = readBackupMarks()
      if (cloudBackupAt != null && Date.now() - cloudBackupAt < MIN_INTERVAL_MS) return
      sending.current = true
      void service
        .backupNow()
        .then((res) => {
          // 成功（非 null）時のみ記録して dirty を下ろす。失敗は次の機会に再試行。
          if (res) {
            dirty.current = false
            markCloudBackup(Date.now())
          }
        })
        .catch(() => {
          // オフライン等。黙って無視し dirty 維持で再試行に回す。
        })
        .finally(() => {
          sending.current = false
        })
    }
    const schedule = () => {
      dirty.current = true
      clear()
      timer.current = setTimeout(flush, IDLE_MS)
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
      flush() // 無効化/アンマウント時にも条件を満たせば送る（fire-and-forget）
      clear()
    }
  }, [store, service, enabled])
}
