/// <reference types="@cloudflare/workers-types" />
/**
 * /api/oauth/* — 認可サーバー窓口（ファサード）。実体は Clerk へ中継する。
 *
 * なぜ要るか: ChatGPT のコネクタは MCP ホストの `/.well-known/oauth-authorization-server`
 * を直接読み、そこに書かれた窓口を叩く。Clerk の URL をそのまま書くと issuer とホストが
 * 食い違って弾かれるため、窓口だけ同一オリジンに置き、中身は Clerk へ渡す。
 *
 * 重要:
 *  - token/register などは **302 にしない**。オリジンを跨ぐリダイレクトで HTTP クライアントは
 *    Authorization ヘッダを落とすため、必ずサーバー側 fetch で中継する。
 *  - authorize だけは 302。利用者のブラウザを Clerk のログイン画面へ送る必要があり、
 *    ChatGPT が見ているのはメタデータに書かれたホストであって飛び先ではない。
 *  - PKCE の code_challenge / code_verifier、DCR の redirect_uris、RFC 8707 の resource は
 *    すべて素通しする。ここは値を解釈しない（＝クライアントと Clerk の取り決めを壊さない）。
 */

import { fetchUpstreamAs, normalizeIssuer, type UpstreamAsMetadata } from '../_lib/oauth-upstream'

interface Env {
  /** 上流の認可サーバー（Clerk）の issuer URL。 */
  MCP_OAUTH_ISSUER?: string
}

/** 窓口名 → 上流メタデータのキーと中継の仕方。 */
const ROUTES: Record<string, { key: keyof UpstreamAsMetadata & string; redirect?: true }> = {
  authorize: { key: 'authorization_endpoint', redirect: true },
  token: { key: 'token_endpoint' },
  register: { key: 'registration_endpoint' },
  revoke: { key: 'revocation_endpoint' },
  introspect: { key: 'introspection_endpoint' },
  userinfo: { key: 'userinfo_endpoint' },
  jwks: { key: 'jwks_uri' },
}

/** 中継で持ち出すヘッダ。Cookie と Host は**渡さない**（自オリジンの資格情報を上流へ漏らさない）。 */
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language']
/** 中継で返すヘッダ。Set-Cookie は返さない（上流のセッションを自オリジンに植えない）。 */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'www-authenticate']

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

const errorJson = (error: string, description: string, status: number) =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })

/** 呼び出し元のクエリを中継先 URL へ載せ替える（同名の繰り返しも保つ）。 */
function withIncomingQuery(target: string, incoming: URL): URL {
  const url = new URL(target)
  for (const [key, value] of incoming.searchParams) url.searchParams.append(key, value)
  return url
}

/** サーバー側 fetch で上流へ中継する（リダイレクトにしない）。 */
async function relay(request: Request, target: URL): Promise<Response> {
  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const init: RequestInit = { method: request.method, headers, redirect: 'follow' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch {
    return errorJson('temporarily_unavailable', '認可サーバーへ到達できませんでした', 502)
  }

  const out = new Headers(CORS)
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }
  // エラー応答（invalid_grant 等）を途中でキャッシュさせない。
  if (!upstream.ok) out.set('cache-control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const segments = Array.isArray(params.path) ? params.path : [params.path ?? '']
  const route = ROUTES[segments.join('/')]
  if (!route) return errorJson('not_found', '窓口がありません', 404)

  const issuer = normalizeIssuer(env.MCP_OAUTH_ISSUER)
  if (!issuer) {
    return errorJson('temporarily_unavailable', 'MCP_OAUTH_ISSUER が未設定です', 503)
  }

  const upstream = await fetchUpstreamAs(issuer)
  const target = upstream?.[route.key]
  if (typeof target !== 'string') {
    // 上流が持たない窓口（例: DCR 未対応での register）はメタデータにも出していない。
    return errorJson('temporarily_unavailable', '認可サーバーの設定を取得できませんでした', 503)
  }

  const destination = withIncomingQuery(target, new URL(request.url))
  if (route.redirect) {
    return new Response(null, {
      status: 302,
      headers: { location: destination.toString(), 'cache-control': 'no-store', ...CORS },
    })
  }
  return await relay(request, destination)
}
