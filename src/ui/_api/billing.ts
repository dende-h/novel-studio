/**
 * 課金（Stripe 直課金）の API クライアント（`/api/billing/*`）。認証は Clerk JWT（Bearer）。
 * 会員判定の源は D1（サーバー）で、クライアントは status を叩いて member かどうかを知る。
 * Checkout / Portal はサーバーが作った URL へ window 遷移する（クライアントに Stripe 鍵は不要）。
 */

type GetToken = () => Promise<string | null>

export type PlanInterval = 'monthly' | 'yearly'

export interface BillingStatus {
  isMember: boolean
  status: string | null
  /** 現在の課金期間の終わり（epoch ms）。 */
  currentPeriodEnd: number | null
  /** >0 なら失効済みで、この時刻以降にクラウドデータが削除される（epoch ms）。 */
  graceUntil: number | null
}

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** サインイン中ユーザーの会員状態。未ログイン/失敗は null。 */
export async function getBillingStatus(getToken: GetToken): Promise<BillingStatus | null> {
  // getToken() はサインイン直後のセッション遷移中などに reject しうる。ここで例外を通すと
  // 呼び出し側（clerk-gate の会員判定 effect）が途中で死んで auth が loading のまま固まるため、
  // トークン取得も含めて「失敗は null」に丸める。
  try {
    const headers = await authHeader(getToken)
    if (!headers) return null
    const res = await fetch('/api/billing/status', { headers })
    if (!res.ok) return null
    return (await res.json()) as BillingStatus
  } catch {
    return null
  }
}

/** Checkout セッションを作り、その Stripe ホスト画面へ遷移する。開始できなければ false。 */
export async function startCheckout(getToken: GetToken, plan: PlanInterval): Promise<boolean> {
  try {
    const headers = await authHeader(getToken)
    if (!headers) return false
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
    if (!res.ok) return false
    const { url } = (await res.json()) as { url?: string }
    if (!url) return false
    window.location.assign(url) // 成功時は Stripe へ遷移（このあと戻らない）。
    return true
  } catch {
    return false
  }
}

/** Customer Portal（解約・支払い方法・請求履歴）を開く。開始できなければ false。 */
export async function openBillingPortal(getToken: GetToken): Promise<boolean> {
  try {
    const headers = await authHeader(getToken)
    if (!headers) return false
    const res = await fetch('/api/billing/portal', { method: 'POST', headers })
    if (!res.ok) return false
    const { url } = (await res.json()) as { url?: string }
    if (!url) return false
    window.location.assign(url)
    return true
  } catch {
    return false
  }
}
