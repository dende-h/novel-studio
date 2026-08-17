import { useEffect, useRef } from 'react'
import type { ConflictInfo } from '@/core/sync/types'
import type { EditorStore } from '@/ui/store/editorStore'
import type { SyncService } from '@/ui/sync/sync-service'

/** 編集が止まってから push（reconcile）するまでの猶予。旧設計の autosave coalesce（~30 秒）を踏襲。 */
const COALESCE_MS = 30_000
/** フォアグラウンド復帰・focus 時に pull し直す最小間隔（切替のたびに叩かない）。 */
const FOREGROUND_MIN_INTERVAL_MS = 60_000
/**
 * 表示中の定期 reconcile 間隔。「開いたまま何もしない端末」には他のトリガが一切発火せず、
 * 他端末の編集が永遠に届かない（stg 実機で判明）ため、可視状態の間は定期的に pull する。
 * 変更が無ければ manifest GET＋activity POST だけの軽い往復で終わる。
 */
const POLL_MS = 90_000

/**
 * 会員の自動同期トリガ。ユーザーは同期を意識しない：
 * - マウント（＝ログイン確定）時に全体 reconcile（他端末の変更を取り込む）
 * - 編集・ゴミ箱操作など store の変化を 30 秒 coalesce して reconcile（push が主目的）
 * - タブがフォアグラウンドへ戻った/ウィンドウが focus されたとき（最小 60 秒間隔）に reconcile
 *   （デスクトップの 2 窓並びは visibilitychange が発火しないので focus も拾う）
 * - 表示中は 90 秒ごとの定期 reconcile（放置している受け側端末にも他端末の編集が届く）
 * - タブが隠れる/離脱する直前に未送信分を flush（fire-and-forget）
 *
 * enabled=false（非会員・未ログイン）では一切動かない＝opt-in（D-SYNC-OPTIN）を維持する。
 * reconcile がローカルを変えたら onLocalChanged（store.init() での再読込）、競合を解決したら
 * onConflicts（トースト通知）を呼ぶ。オフライン失敗は service 側が握り潰し、次のトリガで再試行される。
 */
export function useAutoSync(
  store: EditorStore,
  service: SyncService | null,
  enabled: boolean,
  handlers: {
    onLocalChanged?: () => void
    onConflicts?: (conflicts: ConflictInfo[]) => void
  } = {},
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const lastRunAt = useRef(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!service || !enabled) return

    // 追走・再試行を含む全実行の結果をここで拾う（reconcile() の戻り値だけだと取りこぼす）。
    const unsubSummary = service.subscribeSummary((summary) => {
      if (summary.changedLocal) handlersRef.current.onLocalChanged?.()
      if (summary.conflicts.length > 0) handlersRef.current.onConflicts?.(summary.conflicts)
    })
    const run = () => {
      dirty.current = false
      lastRunAt.current = Date.now()
      void service.reconcile()
    }
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const flush = () => {
      if (!dirty.current) return
      clear()
      run()
    }
    const schedule = () => {
      dirty.current = true
      clear()
      timer.current = setTimeout(flush, COALESCE_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush()
        return
      }
      // 復帰時：別端末での編集を拾う（未送信があれば一緒に push される）。
      if (Date.now() - lastRunAt.current >= FOREGROUND_MIN_INTERVAL_MS) run()
    }
    // デスクトップで 2 窓を並べて切り替えたとき等は visibility が変わらず focus だけ来る。
    const onFocus = () => {
      if (Date.now() - lastRunAt.current >= FOREGROUND_MIN_INTERVAL_MS) run()
    }
    // 定期 pull：非表示のタブでは走らせない（hidden 中の変更は復帰時の onVisibility が拾う）。
    const onPoll = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRunAt.current >= POLL_MS) run()
    }

    run() // ログイン時＝全体同期（旧 D-SYNC-TRIGGER の「2 点」の 1 点目に相当）
    const unsub = store.subscribe(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', flush)
    const poll = setInterval(onPoll, POLL_MS)

    return () => {
      unsub()
      unsubSummary()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', flush)
      clearInterval(poll)
      flush() // 無効化/アンマウント時にも未送信分を送る
      clear()
    }
  }, [store, service, enabled])
}
