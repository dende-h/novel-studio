/// <reference types="@cloudflare/workers-types" />
/**
 * 自前の認可サーバー（OAuth 2.1）の**純ロジック**。I/O は持たない（D1 は `oauth-store.ts`、
 * HTTP は `functions/api/oauth/[[path]].ts`）。テストの主戦場はここ。
 *
 * なぜ自前で持つのか（docs/requirement/10-mcp-oauth.md §4・案3）:
 * Clerk を認可サーバーに据えていた間、**ChatGPT と Clerk の間で何が起きているかが誰にも
 * 見えなかった**。こちらのログにもブラウザにも映らず、同じ操作で結果が変わる。認可・同意・
 * トークン発行を自分の側へ寄せれば、全部が `wrangler tail` に出る。Clerk は「いま誰が
 * ログインしているか」を答える身元確認に退く（利用者の体験は変わらない）。
 *
 * 守っている決めごと:
 *   * **公開クライアントのみ・PKCE S256 必須**（`client_secret` は発行も要求もしない）。
 *   * **`redirect_uri` は登録済みの値と完全一致**。前方一致もワイルドカードも無い
 *     ＝オープンリダイレクタを作らない。一致しないときはリダイレクトせずその場で断る。
 *   * **認可応答には必ず `iss` を付ける**（RFC 9207）。成功も失敗も。ここを守れないことが
 *     元の不具合そのものだった（§2-A）。
 *   * 秘密（コード・トークン）は**平文で保存しない**。SHA-256 のみ（`mcp_tokens` と同じ作法）。
 */

import { sha256Hex } from './crypto'

/** 自前で発行するものの接頭辞。**Clerk 由来のものと見分けるために使う**（互換の相手が分かる）。 */
export const OAUTH_PREFIX = {
  client: 'cid_',
  code: 'mcpc_',
  access: 'mcpa_',
  refresh: 'mcpr_',
} as const

/** 有効期間。コードは短く 1 回限り、アクセスは 1 時間、更新は 90 日。 */
export const OAUTH_TTL = {
  /** 認可コード（ms）。RFC 6749 は「10 分以内」を推すが、正常な交換は数秒で終わる。 */
  code: 60_000,
  /** アクセストークン（秒）。クライアントは `expires_in` を見て更新する。 */
  accessSeconds: 3600,
  /** リフレッシュトークン（ms）。使うたびに回転させる。 */
  refresh: 90 * 24 * 60 * 60 * 1000,
  /** 同意画面へ渡す一時レコード（ms）。人が読んで押すまでの猶予。 */
  request: 10 * 60 * 1000,
} as const

/**
 * こちらが発行するトークンのスコープ。**器を分けない**（作品の読み書きは 1 つの権限）。
 * `offline_access` は「更新してよい」の意思表示で、無ければリフレッシュトークンを出さない。
 */
export const OAUTH_SCOPES = ['mcp', 'offline_access']

/**
 * 上流（Clerk）へ中継するときに使うスコープ。**自前の `mcp` を Clerk へ渡してはいけない**
 * （知らない語なので `invalid_scope` になる）。既に Clerk 側で登録済みのクライアントが
 * 認可し直しに来たときの互換のためだけに残す（§2-I で実測した、Clerk が DCR クライアントへ
 * 許す 3 つ。`openid` は入れない）。
 */
export const LEGACY_CLERK_SCOPES = 'profile email offline_access'

/** 乱数の秘密。接頭辞＋base64url 32byte（`mcp_` トークンと同じ作り）。 */
export function randomSecret(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${prefix}${b64url}`
}

/** 保存・照合の単一実装（平文は残さない）。 */
export const hashSecret = (secret: string): Promise<string> => sha256Hex(secret)

/** 自前で発行した値か。接頭辞で見分け、そうでなければ上流（Clerk）の担当と判断する。 */
export const isOurs = (value: string, prefix: string): boolean => value.startsWith(prefix)

/** base64url（パディング無し）。PKCE の照合に使う。 */
function base64url(bytes: ArrayBuffer): string {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PKCE の S256 変換。`code_verifier` → `code_challenge`。 */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

/** `code_verifier` が `code_challenge` に対応するか（S256 のみ）。 */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false
  return (await s256(verifier)) === challenge
}

// ---------------------------------------------------------------------------
// メタデータ
// ---------------------------------------------------------------------------

/** 窓口の位置。**必ず `/api/` 配下**（Service Worker のナビゲーションフォールバック回避）。 */
export const OAUTH_ENDPOINTS = {
  authorization_endpoint: '/api/oauth/authorize',
  token_endpoint: '/api/oauth/token',
  registration_endpoint: '/api/oauth/register',
  revocation_endpoint: '/api/oauth/revoke',
} as const

/**
 * RFC 8414 の認可サーバーメタデータ。**issuer は自オリジン**で、応答を書くのも自分。
 * かつてここで Clerk の申告を自分の名前で転載して壊した（§2-A/§2-G）。**上流の値は 1 つも混ぜない。**
 */
export function buildAuthServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_ENDPOINTS.authorization_endpoint}`,
    token_endpoint: `${origin}${OAUTH_ENDPOINTS.token_endpoint}`,
    registration_endpoint: `${origin}${OAUTH_ENDPOINTS.registration_endpoint}`,
    revocation_endpoint: `${origin}${OAUTH_ENDPOINTS.revocation_endpoint}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: OAUTH_SCOPES,
    // 認可応答に iss を必ず付ける（RFC 9207）。名乗りと実装を同じファイルで揃える。
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/help`,
  }
}

// ---------------------------------------------------------------------------
// 認可要求の検査
// ---------------------------------------------------------------------------

export interface OAuthClient {
  clientId: string
  clientName: string | null
  clientUri: string | null
  redirectUris: string[]
}

export interface AuthorizeRequest {
  clientId: string
  redirectUri: string
  state: string | null
  scope: string[]
  resource: string | null
  codeChallenge: string
}

/** 検査の結果。`redirectable` が true のときだけ、エラーを redirect_uri へ返してよい。 */
export type AuthorizeCheck =
  | { ok: true; value: AuthorizeRequest }
  | { ok: false; error: string; description: string; redirectable: boolean }

const fail = (error: string, description: string, redirectable = true): AuthorizeCheck => ({
  ok: false,
  error,
  description,
  redirectable,
})

/**
 * `/api/oauth/authorize` のパラメータを検査する。
 *
 * **`redirect_uri` と `client_id` が確かめられるまで、エラーをリダイレクトで返してはいけない**
 * （RFC 6749 §4.1.2.1）。そこを緩めると、知らない URL へ値を運ぶ踏み台になる。
 */
export function checkAuthorize(
  params: URLSearchParams,
  client: OAuthClient | null,
  resource: string,
): AuthorizeCheck {
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  if (!clientId) return fail('invalid_request', 'client_id がありません', false)
  if (!client) return fail('invalid_client', '登録されていない client_id です', false)
  // 完全一致だけ。前方一致・ワイルドカードは作らない（オープンリダイレクタになる）。
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return fail('invalid_request', '登録された redirect_uri と一致しません', false)
  }

  if (params.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'response_type は code だけ対応します')
  }
  const codeChallenge = params.get('code_challenge') ?? ''
  const method = params.get('code_challenge_method') ?? ''
  if (!codeChallenge) return fail('invalid_request', 'PKCE の code_challenge が要ります')
  if (method !== 'S256') return fail('invalid_request', 'code_challenge_method は S256 だけです')

  // RFC 8707。付いていれば、この MCP エンドポイント宛てかを確かめる（別の相手向けの
  // トークンを出さない）。付いていなければ既定でこのリソース宛てにする。
  const rawResource = params.get('resource')
  if (rawResource && rawResource.replace(/\/$/, '') !== resource.replace(/\/$/, '')) {
    return fail('invalid_target', 'resource がこのサーバーのものと一致しません')
  }

  const requested = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)
  const unknown = requested.filter((s) => !OAUTH_SCOPES.includes(s))
  if (unknown.length > 0) {
    return fail('invalid_scope', `対応していないスコープです: ${unknown.join(' ')}`)
  }

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      state: params.get('state'),
      // 何も要求されなければ既定を与える（黙って権限ゼロのトークンを出さない）。
      scope: requested.length > 0 ? requested : OAUTH_SCOPES,
      resource: rawResource ?? resource,
      codeChallenge,
    },
  }
}

/**
 * 認可応答の URL を組む。**`iss` を必ず載せる**（成功も失敗も・RFC 9207）。
 * 既存のクエリは壊さない（クライアントが redirect_uri に付けている値を消さない）。
 */
export function buildAuthorizeRedirect(
  redirectUri: string,
  issuer: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== '') url.searchParams.set(key, value)
  }
  url.searchParams.set('iss', issuer)
  return url.toString()
}

// ---------------------------------------------------------------------------
// 動的クライアント登録（RFC 7591）
// ---------------------------------------------------------------------------

export interface RegistrationInput {
  redirectUris: string[]
  clientName: string | null
  clientUri: string | null
}

export type RegistrationCheck =
  | { ok: true; value: RegistrationInput }
  | { ok: false; error: string; description: string }

/**
 * 登録要求を検査する。**公開クライアントだけ**を受け付け、`client_secret` は発行しない。
 * `redirect_uris` は https（と、手元の道具のための http://localhost）に限る。
 */
export function checkRegistration(body: unknown): RegistrationCheck {
  const b = (body ?? {}) as Record<string, unknown>
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : []
  if (uris.length === 0) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris が要ります' }
  }
  if (uris.length > 10) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris が多すぎます' }
  }
  const redirectUris: string[] = []
  for (const raw of uris) {
    if (typeof raw !== 'string') {
      return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris の形式' }
    }
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, error: 'invalid_redirect_uri', description: `URL ではありません: ${raw}` }
    }
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
      return {
        ok: false,
        error: 'invalid_redirect_uri',
        description: 'https（または http://localhost）だけ受け付けます',
      }
    }
    redirectUris.push(raw)
  }

  const method = b.token_endpoint_auth_method
  if (method !== undefined && method !== 'none') {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description: '公開クライアント（token_endpoint_auth_method: none）だけ対応します',
    }
  }

  const str = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

  return {
    ok: true,
    value: {
      redirectUris,
      clientName: str(b.client_name, 100),
      clientUri: str(b.client_uri, 300),
    },
  }
}

/** RFC 7591 の登録応答。`client_secret` は返さない（公開クライアント）。 */
export function buildRegistrationResponse(
  client: OAuthClient,
  issuedAt: number,
): Record<string, unknown> {
  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(issuedAt / 1000),
    client_name: client.clientName ?? undefined,
    client_uri: client.clientUri ?? undefined,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: OAUTH_SCOPES.join(' '),
  }
}
