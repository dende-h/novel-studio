import { useEffect, useRef } from 'react'
import type { ConflictInfo } from '@/core/sync/types'
import type { EditorStore } from '@/ui/store/editorStore'
import type { SyncService } from '@/ui/sync/sync-service'
import { publishSyncStatus } from '@/ui/sync/sync-status'
import { subscribeSyncTouch } from '@/ui/sync/sync-touch'

/** 編集が止まってから push（reconcile）するまでの猶予。素早くタブを閉じても取り残さない
 * よう短く取る（閉じる直前の flush＋keepalive 送信も別途ある）。 */
const COALESCE_MS = 1_500
/**
 * 軽量ポーリング（service.poll()）の間隔。バースト中＝アプリを開いた・画面遷移した・
 * フォアグラウンドへ戻った直後だけ 5 秒に上げ、それ以外は 10 秒に落とす。
 * 「端末を切り替えた直後」がいちばん取り込みを急ぐ場面で、放置中の張り付きは安くしたい。
 */
const POLL_FAST_MS = 5_000
const POLL_MS = 10_000
/** バースト（5 秒間隔）を維持する時間。注意イベントからこの間だけ速く回す。 */
const BURST_MS = 30_000
/**
 * 完全同期（世代チェックを飛ばした reconcile）の最大間隔。push 失敗の取り残し等、
 * 世代チェックでは拾えないズレの回収網。
 */
const FULL_SYNC_MS = 5 * 60_000

/**
 * 会員の自動同期トリガ。ユーザーは同期を意識しない：
 * - マウント（＝ログイン確定）時に全体 reconcile（他端末の変更を取り込む）
 * - 編集・ゴミ箱操作など store の変化を 1.5 秒 coalesce して reconcile（push が主目的）
 * - 表示中は軽量 poll（世代が動いたときだけ本同期）。マウント・画面遷移（attentionKey の
 *   変化）・フォアグラウンド復帰/focus の直後 30 秒は 5 秒間隔、それ以外は 10 秒間隔
 * - 5 分ごとの完全同期（世代チェックを飛ばした reconcile）で取り残しを回収
 * - タブが隠れる/離脱する直前に未送信分を flush（fire-and-forget）
 *
 * enabled=false（非会員・未ログイン）では一切動かない＝opt-in（D-SYNC-OPTIN）を維持する。
 * reconcile がローカルを変えたら onLocalChanged（store.init() での再読込）、競合が決着したら
 * onConflicts を呼ぶ。オフライン失敗は service 側が握り潰し、次のトリガで再試行される。
 * 進行状況は sync-status へ publish し、ヘッダーが「同期中…」を出す
 * （結果をトーストで知らせない＝頻繁に走る処理で通知を鳴らし続けない）。
 */
export function useAutoSync(
  store: EditorStore,
  service: SyncService | null,
  enabled: boolean,
  handlers: {
    onLocalChanged?: () => void
    onConflicts?: (conflicts: ConflictInfo[]) => void
  } = {},
  /** 画面遷移の検知用（Root がハッシュルートを渡す）。変わるとポーリングをバーストさせる。 */
  attentionKey?: unknown,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const lastRunAt = useRef(0)
  const lastFullAt = useRef(0)
  const burstUntil = useRef(0)
  const runPollRef = useRef<(() => void) | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!service || !enabled) return

    publishSyncStatus({ enabled: true })
    // 追走・再試行を含む全実行の結果をここで拾う（reconcile() の戻り値だけだと取りこぼす）。
    const unsubSummary = service.subscribeSummary((summary) => {
      publishSyncStatus({ lastSyncedAt: Date.now() })
      if (summary.changedLocal) handlersRef.current.onLocalChanged?.()
      if (summary.conflicts.length > 0) handlersRef.current.onConflicts?.(summary.conflicts)
    })
    // ヘッダーのスピナー用（本同期の実行中だけ true。軽量 poll では点かない）。
    const unsubRunning = service.subscribeRunning((running) =>
      publishSyncStatus({ syncing: running }),
    )
    const run = () => {
      dirty.current = false
      lastRunAt.current = Date.now()
      lastFullAt.current = Date.now()
      void service.reconcile()
    }
    // 軽量チェック：世代が動いたときだけ本同期。5 分に 1 回は完全同期で取り残しを回収する。
    const runPoll = () => {
      if (Date.now() - lastFullAt.current >= FULL_SYNC_MS) {
        run()
        return
      }
      lastRunAt.current = Date.now()
      void service.poll()
    }
    runPollRef.current = runPoll
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
    // フォアグラウンド復帰・focus・画面遷移＝「端末を切り替えた直後」の代表例。
    // バーストを張り直し、前回から間が空いていれば即 poll する（連打は 5 秒で間引く）。
    const attention = () => {
      burstUntil.current = Date.now() + BURST_MS
      if (Date.now() - lastRunAt.current >= POLL_FAST_MS) runPoll()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush()
        return
      }
      attention()
    }
    // デスクトップで 2 窓を並べて切り替えたとき等は visibility が変わらず focus だけ来る。
    const onFocus = () => attention()
    // 定期 poll：非表示のタブでは走らせない（hidden 中の変更は復帰時の onVisibility が拾う）。
    // tick は常に 5 秒刻みで、バースト外は経過 10 秒未満をスキップ＝実質 5/10 秒の二段変速。
    const onPoll = () => {
      if (document.visibilityState !== 'visible') return
      const minInterval = Date.now() < burstUntil.current ? POLL_FAST_MS : POLL_MS
      if (Date.now() - lastRunAt.current >= minInterval) runPoll()
    }

    burstUntil.current = Date.now() + BURST_MS // 開いた直後は取り込みを急ぐ
    run() // ログイン時＝全体同期（旧 D-SYNC-TRIGGER の「2 点」の 1 点目に相当）
    const unsub = store.subscribe(schedule)
    // 構造・ネタ帳の編集は store を通らないため、専用シグナル（sync-touch）でも coalesce を張る。
    const unsubTouch = subscribeSyncTouch(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', flush)
    const poll = setInterval(onPoll, POLL_FAST_MS)

    return () => {
      unsub()
      unsubTouch()
      unsubSummary()
      unsubRunning()
      publishSyncStatus({ enabled: false, syncing: false })
      runPollRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', flush)
      clearInterval(poll)
      flush() // 無効化/アンマウント時にも未送信分を送る
      clear()
    }
  }, [store, service, enabled])

  // 画面遷移（attentionKey の変化）でもバースト＋即 poll。マウント直後は上の run() が
  // lastRunAt を刻んだばかりなので間引かれ、二重同期にはならない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger（attentionKey）の変化でバーストを張り直すための意図的な依存
  useEffect(() => {
    if (!service || !enabled) return
    burstUntil.current = Date.now() + BURST_MS
    if (Date.now() - lastRunAt.current >= POLL_FAST_MS) runPollRef.current?.()
  }, [attentionKey, service, enabled])
}
