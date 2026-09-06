/**
 * 同意画面（`#/connect`）の API クライアント（`/api/oauth/consent`）。認証は Clerk JWT（Bearer）。
 *
 * AI の接続を許すかどうかを決める画面で使う。認可コードの発行はサーバ側で、ここは
 * **飛び先の URL を受け取って移動するだけ**（値を組み立てない＝画面から改ざんできない）。
 */

type GetToken = () => Promise<string | null>

export interface ConsentInfo {
  /** AI 側が名乗ったアプリ名（登録時に付いていなければ null）。 */
  clientName: string | null
  clientUri: string | null
  /** 許可後に戻る先のホスト（例: chatgpt.com）。誰へ渡すのかを画面に出すために使う。 */
  redirectHost: string | null
  scope: string[]
  isMember: boolean
}

/** 同意画面の結果。`error` は画面がそのまま出し分けるための札。 */
export type ConsentResult =
  | { ok: true; info: ConsentInfo }
  | { ok: false; error: 'unauthorized' | 'expired' | 'failed' }

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** 何を許そうとしているかを取りに行く。 */
export async function fetchConsent(getToken: GetToken, rid: string): Promise<ConsentResult> {
  const headers = await authHeader(getToken)
  if (!headers) return { ok: false, error: 'unauthorized' }
  try {
    const res = await fetch(`/api/oauth/consent?rid=${encodeURIComponent(rid)}`, { headers })
    if (res.status === 401) return { ok: false, error: 'unauthorized' }
    if (res.status === 404) return { ok: false, error: 'expired' }
    if (!res.ok) return { ok: false, error: 'failed' }
    return { ok: true, info: (await res.json()) as ConsentInfo }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** 許可／拒否を送り、戻り先の URL を受け取る。 */
export type DecideResult =
  | { ok: true; redirect: string }
  | { ok: false; error: 'unauthorized' | 'expired' | 'subscription_required' | 'failed' }

export async function decideConsent(
  getToken: GetToken,
  rid: string,
  approve: boolean,
): Promise<DecideResult> {
  const headers = await authHeader(getToken)
  if (!headers) return { ok: false, error: 'unauthorized' }
  try {
    const res = await fetch('/api/oauth/consent', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ rid, approve }),
    })
    if (res.status === 401) return { ok: false, error: 'unauthorized' }
    if (res.status === 402) return { ok: false, error: 'subscription_required' }
    if (res.status === 404) return { ok: false, error: 'expired' }
    if (!res.ok) return { ok: false, error: 'failed' }
    return { ok: true, redirect: ((await res.json()) as { redirect: string }).redirect }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
