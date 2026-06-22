import { useEffect, useRef, useState } from 'react'
import { checkSession, claimSession, clearSessionToken } from '@/ui/_api/session'
import { useAuth } from './auth-context'

const POLL_MS = 60_000

/**
 * 単一アクティブセッションの監視。member になったら claim → 定期／フォーカス時に status 確認。
 * 別端末に奪われたら superseded=true（同期停止バナー用）。Phase 1 は監視と通知のみ（同期はしない）。
 */
export function useSessionGuard(): { superseded: boolean } {
  const { status, userId, getToken } = useAuth()
  const [superseded, setSuperseded] = useState(false)
  // getToken の参照変化で effect が再実行されないよう ref に退避する。
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  // claim が「成功した」userId と、claim 実行中フラグ。
  // StrictMode の effect 二重実行や member 再突入での二重トークン回転を防ぐ。
  const claimedForRef = useRef<string | null>(null)
  const claimingRef = useRef(false)

  useEffect(() => {
    if (status !== 'member') {
      setSuperseded(false)
      claimedForRef.current = null
      claimingRef.current = false
      return
    }
    let alive = true
    let stopped = false
    const token = () => getTokenRef.current()

    const check = async () => {
      if (stopped) return
      const r = await checkSession(token)
      if (!alive) return
      if (r === 'superseded') {
        setSuperseded(true)
        // 奪われた端末は再ログインしない限り復帰しない。無駄な status ポーリングを止める。
        stopped = true
      }
    }

    const onFocus = () => void check()
    const intervalId = window.setInterval(() => void check(), POLL_MS)
    window.addEventListener('focus', onFocus)

    void (async () => {
      if (claimedForRef.current === userId) {
        // この端末は既に claim 済み → status 確認のみ。
        await check()
        return
      }
      if (claimingRef.current) {
        // 別実行（StrictMode 二重）が claim 中。二重 claim せず、確認も成功側に任せる。
        return
      }
      claimingRef.current = true
      const ok = await claimSession(token)
      claimingRef.current = false
      if (!ok) {
        // claim 失敗：status を確認しない（stale/空トークンでの偽 superseded を防ぐ）。
        // 残留トークンが次回照合へ混入しないよう破棄し、次の interval／focus で再試行させる。
        if (alive) clearSessionToken()
        return
      }
      claimedForRef.current = userId
      if (!alive) return
      await check()
    })()

    return () => {
      alive = false
      stopped = true
      window.removeEventListener('focus', onFocus)
      window.clearInterval(intervalId)
    }
  }, [status, userId])

  return { superseded }
}
