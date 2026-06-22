/**
 * 単一アクティブセッションの同期 API クライアント（Pages Functions `/api/session/*` 用）。
 * 端末ローカルのセッショントークンは localStorage に持ち、status 確認時に提示する。
 */

const TOKEN_KEY = 'sync-session-token'

type GetToken = () => Promise<string | null>

/**
 * 端末ローカルのセッショントークンを破棄する。
 * サインアウト時・claim 失敗時に呼び、前回／前ユーザーのトークン残留が status 照合へ混入するのを防ぐ。
 */
export function clearSessionToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** ログイン直後にこの端末を唯一の有効セッションとして登録する（旧端末は無効化される）。 */
export async function claimSession(getToken: GetToken): Promise<boolean> {
  const jwt = await getToken()
  if (!jwt) return false
  try {
    const res = await fetch('/api/session/claim', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) return false
    const data = (await res.json()) as { sessionToken?: string }
    if (!data.sessionToken) return false
    localStorage.setItem(TOKEN_KEY, data.sessionToken)
    return true
  } catch {
    return false
  }
}

export type SessionState = 'active' | 'superseded' | 'unknown'

/** 現在の端末がまだ唯一の有効セッションか確認する。409 で superseded（別端末に奪われた）。 */
export async function checkSession(getToken: GetToken): Promise<SessionState> {
  const jwt = await getToken()
  if (!jwt) return 'unknown'
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  try {
    const res = await fetch('/api/session/status', {
      headers: { Authorization: `Bearer ${jwt}`, 'X-Session-Token': token },
    })
    if (res.status === 409) return 'superseded'
    if (!res.ok) return 'unknown'
    return 'active'
  } catch {
    return 'unknown'
  }
}
