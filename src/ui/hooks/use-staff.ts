import { useEffect, useState } from 'react'
import { fetchMe } from '@/ui/_api/board'
import { useAuth } from '@/ui/auth/auth-context'

/**
 * 自分が運営（掲示板の staff）か。管理ページの入口の出し分けに使う。
 *
 * 判定の正本はサーバ（`board_profiles.role`）で、画面は `GET /api/board/me` の結果を読むだけ。
 * `enabled` が false のあいだは問い合わせない＝毎回の起動で全員に 1 リクエスト増やさない
 * （管理ページの URL を開いたときと、設定ページを開いたときだけ調べる）。
 *
 * 返り値：null ＝ まだ分からない（サインインの確定待ち・問い合わせ中）／true・false ＝ 確定。
 */
export function useIsStaff(enabled: boolean): boolean | null {
  const { status, isSignedIn, getToken } = useAuth()
  const [staff, setStaff] = useState<boolean | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (status === 'loading') {
      setStaff(null)
      return
    }
    if (!isSignedIn) {
      setStaff(false)
      return
    }
    let alive = true
    setStaff(null)
    void fetchMe(getToken).then((res) => {
      if (!alive) return
      setStaff(res.ok && res.data.profile?.role === 'staff')
    })
    return () => {
      alive = false
    }
  }, [enabled, status, isSignedIn, getToken])

  return enabled ? staff : false
}
