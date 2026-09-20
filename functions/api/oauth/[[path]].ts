/// <reference types="@cloudflare/workers-types" />
/**
 * /api/oauth/* — **自前の認可サーバー**（OAuth 2.1・公開クライアント・PKCE 必須）。
 *
 * 経緯は docs/requirement/10-mcp-oauth.md。要点だけ書くと、Clerk を認可サーバーに据えていた間は
 * **ChatGPT と Clerk の間で何が起きているか誰にも見えなかった**。ここを自分で持つと、認可も
 * トークン発行も全部こちらのログに出る。Clerk は「いま誰がログインしているか」の身元確認に退く
 *（同意画面がアプリ内にあり、そこが既存の Clerk セッションを使う）。
 *
 * **二重運転**（後方互換・CLAUDE.md）:
 *   * `client_id` が `cid_` で始まる＝こちらが登録したクライアント → 自前で処理する。
 *   * それ以外 → **従来どおり Clerk へ中継**する。ファサード時代に Clerk へ登録された
 *     クライアント（既に接続済みの Claude 等）が、そのまま更新・再認可できる状態を保つ。
 *     消すと「繋がっていたのに、ある日黙って切れる」になる。
 *   * 中継する認可要求のスコープは `LEGACY_CLERK_SCOPES` へ差し替える。自前の `mcp` を
 *     Clerk へ渡すと知らない語として `invalid_scope` になるため。
 */

import {
  type AuthorizeRequest,
  buildAuthorizeRedirect,
  buildRegistrationResponse,
  checkAuthorize,
  checkRegistration,
  hashSecret,
  isOurs,
  LEGACY_CLERK_SCOPES,
  OAUTH_PREFIX,
  OAUTH_TTL,
  randomSecret,
  verifyPkce,
} from '../_lib/oauth-server'
import {
  deleteToken,
  insertClient,
  insertRequest,
  insertToken,
  readClient,
  readToken,
  sweepExpired,
  takeCode,
} from '../_lib/oauth-store'
import { fetchUpstreamAs, normalizeIssuer, type UpstreamAsMetadata } from '../_lib/oauth-upstream'

interface Env {
  DB: D1Database
  /** 上流（Clerk）の issuer。**中継の相手**としてだけ使う（名乗る issuer は自オリジン）。 */
  MCP_OAUTH_ISSUER?: string
}

/** 中継先に残す窓口（自前で処理しないもの＝互換のため）。 */
const RELAY_ROUTES: Record<string, keyof UpstreamAsMetadata & string> = {
  authorize: 'authorization_endpoint',
  token: 'token_endpoint',
  register: 'registration_endpoint',
  revoke: 'revocation_endpoint',
  introspect: 'introspection_endpoint',
  userinfo: 'userinfo_endpoint',
  jwks: 'jwks_uri',
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

/**
 * リダイレクトで返してはいけないエラーの見せ方（redirect_uri が確かめられていないとき）。
 * 押した人が読むので、素の JSON でなく短い HTML にする。
 */
const errorPage = (title: string, detail: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>接続できません</title>` +
      `<body style="font-family:system-ui;margin:3rem auto;max-width:32rem;line-height:1.8">` +
      `<h1 style="font-size:1.2rem">${title}</h1><p>${detail}</p>` +
      `<p>お使いの AI 側の設定を確認してください。</p></body>`,
    {
      status: 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )

const redirectTo = (location: string) =>
  new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...CORS } })

// ---------------------------------------------------------------------------
// 上流（Clerk）への中継 — 既に Clerk へ登録済みのクライアントのため
// ---------------------------------------------------------------------------

async function relayTarget(env: Env, route: string): Promise<URL | null> {
  const issuer = normalizeIssuer(env.MCP_OAUTH_ISSUER)
  if (!issuer) return null
  const key = RELAY_ROUTES[route]
  if (!key) return null
  const upstream = await fetchUpstreamAs(issuer)
  const target = upstream?.[key]
  return typeof target === 'string' ? new URL(target) : null
}

/** サーバー側 fetch で上流へ中継する（302 にしない＝Authorization が落ちるため）。 */
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
  if (!upstream.ok) out.set('cache-control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

// ---------------------------------------------------------------------------
// authorize
// ---------------------------------------------------------------------------

async function handleAuthorize(request: Request, env: Env, url: URL): Promise<Response> {
  const clientId = url.searchParams.get('client_id') ?? ''

  // 旧クライアント（Clerk 側に登録がある）は従来どおり Clerk のログイン画面へ送る。
  if (!isOurs(clientId, OAUTH_PREFIX.client)) {
    const target = await relayTarget(env, 'authorize')
    if (!target) return errorPage('接続できません', '認可サーバーの設定を取得できませんでした。')
    for (const [key, value] of url.searchParams) {
      // 自前のスコープ（mcp）を Clerk へ渡すと invalid_scope になる。互換の値へ差し替える。
      if (key === 'scope') continue
      target.searchParams.append(key, value)
    }
    target.searchParams.set('scope', LEGACY_CLERK_SCOPES)
    return redirectTo(target.toString())
  }

  const resource = `${url.origin}/api/mcp`
  const client = await readClient(env.DB, clientId)
  const checked = checkAuthorize(url.searchParams, client, resource)

  if (!checked.ok) {
    // redirect_uri を確かめられていないときは、そこへ値を運ばない（踏み台にしない）。
    if (!checked.redirectable) return errorPage('接続できません', checked.description)
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    return redirectTo(
      buildAuthorizeRedirect(redirectUri, url.origin, {
        error: checked.error,
        error_description: checked.description,
        state: url.searchParams.get('state'),
      }),
    )
  }

  const req: AuthorizeRequest = checked.value
  const rid = randomSecret('rq_')
  const now = Date.now()
  await insertRequest(
    env.DB,
    {
      rid,
      clientId: req.clientId,
      redirectUri: req.redirectUri,
      state: req.state,
      scope: req.scope.join(' '),
      resource: req.resource,
      codeChallenge: req.codeChallenge,
    },
    now,
    now + OAUTH_TTL.request,
  )

  // 同意はアプリ内の画面で取る。既にログイン済みならそのまま、未ログインなら画面側が
  // Clerk のサインインを出す（ページの URL は変わらないので戻り先の受け渡しが要らない）。
  return redirectTo(`${url.origin}/#/connect?rid=${encodeURIComponent(rid)}`)
}

// ---------------------------------------------------------------------------
// token
// ---------------------------------------------------------------------------

/** トークン一式を発行する。`offline_access` があるときだけ更新用も返す。 */
async function issueTokens(
  db: D1Database,
  base: { userId: string; clientId: string; scope: string; resource: string | null },
  now: number,
): Promise<Record<string, unknown>> {
  const access = randomSecret(OAUTH_PREFIX.access)
  await insertToken(
    db,
    await hashSecret(access),
    'access',
    base,
    now,
    now + OAUTH_TTL.accessSeconds * 1000,
  )

  const body: Record<string, unknown> = {
    access_token: access,
    token_type: 'Bearer',
    expires_in: OAUTH_TTL.accessSeconds,
    scope: base.scope,
  }

  if (base.scope.split(' ').includes('offline_access')) {
    const refresh = randomSecret(OAUTH_PREFIX.refresh)
    await insertToken(db, await hashSecret(refresh), 'refresh', base, now, now + OAUTH_TTL.refresh)
    body.refresh_token = refresh
  }
  return body
}

const tokenJson = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })

async function handleToken(request: Request, env: Env): Promise<Response> {
  const raw = await request.text()
  const form = new URLSearchParams(raw)
  const grant = form.get('grant_type') ?? ''
  const code = form.get('code') ?? ''
  const refresh = form.get('refresh_token') ?? ''

  // 自前で発行した秘密でなければ、Clerk が出したもの。従来どおり中継する。
  const ours =
    (grant === 'authorization_code' && isOurs(code, OAUTH_PREFIX.code)) ||
    (grant === 'refresh_token' && isOurs(refresh, OAUTH_PREFIX.refresh))
  if (!ours) {
    const target = await relayTarget(env, 'token')
    if (!target) return errorJson('invalid_grant', '知らない grant です', 400)
    return await relay(
      new Request(request.url, { method: 'POST', headers: request.headers, body: raw }),
      target,
    )
  }

  const now = Date.now()
  // 期限切れの掃除はここで巻き取る（cron を増やさない）。失敗しても本処理は止めない。
  try {
    await sweepExpired(env.DB, now)
  } catch {
    /* 掃除の失敗は無視してよい（読み出しが期限で弾く） */
  }

  if (grant === 'authorization_code') {
    const stored = await takeCode(env.DB, await hashSecret(code), now)
    if (!stored) return errorJson('invalid_grant', 'コードが無効か、期限切れです', 400)
    if (stored.clientId !== (form.get('client_id') ?? '')) {
      return errorJson('invalid_grant', 'client_id が一致しません', 400)
    }
    if (stored.redirectUri !== (form.get('redirect_uri') ?? '')) {
      return errorJson('invalid_grant', 'redirect_uri が一致しません', 400)
    }
    if (!(await verifyPkce(form.get('code_verifier') ?? '', stored.codeChallenge))) {
      return errorJson('invalid_grant', 'PKCE の検証に失敗しました', 400)
    }
    return tokenJson(await issueTokens(env.DB, stored, now))
  }

  // refresh_token：**使うたびに回転**させ、古いほうは即失効させる（再利用を残さない）。
  const oldHash = await hashSecret(refresh)
  const stored = await readToken(env.DB, oldHash, 'refresh', now)
  if (!stored) return errorJson('invalid_grant', '更新トークンが無効か、期限切れです', 400)
  await deleteToken(env.DB, oldHash)
  return tokenJson(await issueTokens(env.DB, stored, now))
}

// ---------------------------------------------------------------------------
// register / revoke
// ---------------------------------------------------------------------------

async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorJson('invalid_client_metadata', 'JSON として読めません', 400)
  }
  const checked = checkRegistration(body)
  if (!checked.ok) return errorJson(checked.error, checked.description, 400)

  const client = {
    clientId: randomSecret(OAUTH_PREFIX.client),
    clientName: checked.value.clientName,
    clientUri: checked.value.clientUri,
    redirectUris: checked.value.redirectUris,
  }
  const now = Date.now()
  await insertClient(env.DB, client, now)
  return new Response(JSON.stringify(buildRegistrationResponse(client, now)), {
    status: 201,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })
}

/** RFC 7009。知らないトークンでも 200 を返す（存在の有無を漏らさない）。 */
async function handleRevoke(request: Request, env: Env): Promise<Response> {
  const raw = await request.text()
  const token = new URLSearchParams(raw).get('token') ?? ''
  if (isOurs(token, OAUTH_PREFIX.access) || isOurs(token, OAUTH_PREFIX.refresh)) {
    await deleteToken(env.DB, await hashSecret(token))
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', ...CORS } })
  }
  const target = await relayTarget(env, 'revoke')
  if (!target)
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', ...CORS } })
  return await relay(
    new Request(request.url, { method: 'POST', headers: request.headers, body: raw }),
    target,
  )
}

// ---------------------------------------------------------------------------

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const segments = Array.isArray(params.path) ? params.path : [params.path ?? '']
  const route = segments.join('/')
  const url = new URL(request.url)

  if (route === 'authorize') return await handleAuthorize(request, env, url)
  if (route === 'token' && request.method === 'POST') return await handleToken(request, env)
  if (route === 'register' && request.method === 'POST') return await handleRegister(request, env)
  if (route === 'revoke' && request.method === 'POST') return await handleRevoke(request, env)

  // jwks / userinfo / introspect は自前で持たない（Clerk 発行トークンの互換のため中継だけ残す）。
  const target = await relayTarget(env, route)
  if (!target) return errorJson('not_found', '窓口がありません', 404)
  for (const [key, value] of url.searchParams) target.searchParams.append(key, value)
  return await relay(request, target)
}
