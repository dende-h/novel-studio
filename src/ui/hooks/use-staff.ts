import { useEffect, useRef, useState } from 'react'
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
 *
 * **一度決まったら、問い合わせ直しの間も前の値を返す。** 認証コンテキストの `getToken` は
 * 描画のたびに新しい関数になる（Clerk のトークン更新でも描画が走る）ので、それを依存に取って
 * null へ戻すと、Root が読み込み画面を挟んで管理ページを作り直し、開いていたタブや未保存の
 * 下書きが消えていた（「作業中に定期的にロードが入る」）。getToken は ref で束ねて依存から外す。
 */
export function useIsStaff(enabled: boolean): boolean | null {
  const { status, isSignedIn, getToken } = useAuth()
  const [staff, setStaff] = useState<boolean | null>(null)
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  useEffect(() => {
    if (!enabled) return
    // サインインの確定待ち：まだ決まっていなければ待つだけ。決まっていた値は据え置く
    if (status === 'loading') return
    if (!isSignedIn) {
      setStaff(false)
      return
    }
    let alive = true
    void fetchMe(() => getTokenRef.current()).then((res) => {
      if (!alive) return
      setStaff(res.ok && res.data.profile?.role === 'staff')
    })
    return () => {
      alive = false
    }
  }, [enabled, status, isSignedIn])

  return enabled ? staff : false
}
