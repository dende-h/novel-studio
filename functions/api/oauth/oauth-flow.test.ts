// @vitest-environment node
/**
 * 自前の認可サーバーを**端から端まで**通す（登録 → 認可 → 同意 → トークン → MCP 認証 → 更新）。
 * SQL は実 SQLite（`real-d1.ts`）に当てる。
 *
 * ここで守りたいのは「通ってはいけないものが通らない」ほう——コードの使い回し、PKCE の
 * すり替え、更新トークンの再利用、非会員の通過。全部この 1 本で見張る。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const member = { userId: 'user_1', isMember: true }
const state = { member: member as { userId: string; isMember: boolean } | null }

// Clerk セッションの検証だけ差し替える（json はそのまま使う）。
vi.mock('../_lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/auth')>()
  return { ...actual, verifyMember: async () => state.member }
})

const { onRequest } = await import('./[[path]].ts')
const consent = await import('./consent.ts')
const { makeOAuthD1 } = await import('./real-d1')
const { resolveMcpAuth } = await import('../_lib/mcp-auth')
const { s256, randomSecret } = await import('../_lib/oauth-server')

const ORIGIN = 'https://stg.example.pages.dev'
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'

let harness: ReturnType<typeof makeOAuthD1>
let env: { DB: D1Database; MCP_OAUTH_ISSUER?: string }

beforeEach(() => {
  harness?.close()
  harness = makeOAuthD1()
  env = { DB: harness.db }
  state.member = { ...member }
})

type Ctx = Parameters<typeof onRequest>[0]
const route = (request: Request, path: string[]) =>
  onRequest({ request, env, params: { path } } as unknown as Ctx)

const post = (path: string, body: string, ctype: string) =>
  new Request(`${ORIGIN}/api/oauth/${path}`, {
    method: 'POST',
    headers: { 'content-type': ctype },
    body,
  })

/** 登録 → 認可 → 同意（許可）まで進め、認可コードを返す。 */
async function authorizeUpToCode(verifier: string) {
  const reg = await route(
    post(
      'register',
      JSON.stringify({
        client_name: 'ChatGPT',
        client_uri: 'https://chatgpt.com',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
      }),
      'application/json',
    ),
    ['register'],
  )
  expect(reg.status).toBe(201)
  const clientId = ((await reg.json()) as { client_id: string }).client_id
  expect(clientId.startsWith('cid_')).toBe(true)

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
    state: 'st1',
    scope: 'mcp offline_access',
    resource: `${ORIGIN}/api/mcp`,
  })
  const auth = await route(new Request(`${ORIGIN}/api/oauth/authorize?${query}`), ['authorize'])
  expect(auth.status).toBe(302)
  const location = auth.headers.get('location') ?? ''
  expect(location.startsWith(`${ORIGIN}/#/connect?rid=`)).toBe(true)
  const rid = new URLSearchParams(location.split('?')[1]).get('rid') ?? ''

  const approved = await consent.onRequestPost({
    request: new Request(`${ORIGIN}/api/oauth/consent`, {
      method: 'POST',
      body: JSON.stringify({ rid, approve: true }),
    }),
    env,
  } as never)
  expect(approved.status).toBe(200)
  const redirect = new URL(((await approved.json()) as { redirect: string }).redirect)
  return { clientId, rid, redirect }
}

const exchange = (clientId: string, code: string, verifier: string, redirectUri = REDIRECT) =>
  route(
    post(
      'token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }).toString(),
      'application/x-www-form-urlencoded',
    ),
    ['token'],
  )

describe('自前の認可サーバー — 通る道', () => {
  it('登録から MCP の認証まで通り、認可応答に iss が載る', async () => {
    const verifier = randomSecret('')
    const { clientId, redirect } = await authorizeUpToCode(verifier)

    expect(redirect.origin + redirect.pathname).toBe(REDIRECT)
    expect(redirect.searchParams.get('state')).toBe('st1')
    // §2-A の再発防止。名乗る issuer と応答の iss が同じであること。
    expect(redirect.searchParams.get('iss')).toBe(ORIGIN)
    const code = redirect.searchParams.get('code') ?? ''
    expect(code.startsWith('mcpc_')).toBe(true)

    const res = await exchange(clientId, code, verifier)
    expect(res.status).toBe(200)
    const token = (await res.json()) as Record<string, string>
    expect(token.token_type).toBe('Bearer')
    expect(token.access_token.startsWith('mcpa_')).toBe(true)
    expect(token.refresh_token.startsWith('mcpr_')).toBe(true)

    // そのトークンで MCP エンドポイントの認証が解けること（三系統の 2 番目）。
    const principal = await resolveMcpAuth(
      new Request(`${ORIGIN}/api/mcp`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      {},
      harness.db,
      { isMember: async () => true },
    )
    expect(principal).toMatchObject({ userId: 'user_1', isMember: true, via: 'self' })
  })

  it('更新トークンは回転し、古いほうは即使えなくなる', async () => {
    const verifier = randomSecret('')
    const { clientId, redirect } = await authorizeUpToCode(verifier)
    const first = (await (
      await exchange(clientId, redirect.searchParams.get('code') ?? '', verifier)
    ).json()) as Record<string, string>

    const refreshOnce = () =>
      route(
        post(
          'token',
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: first.refresh_token,
          }).toString(),
          'application/x-www-form-urlencoded',
        ),
        ['token'],
      )

    const rotated = await refreshOnce()
    expect(rotated.status).toBe(200)
    const next = (await rotated.json()) as Record<string, string>
    expect(next.refresh_token).not.toBe(first.refresh_token)

    // 同じ更新トークンの二度目は通らない（再利用を残さない）。
    expect((await refreshOnce()).status).toBe(400)
  })

  it('拒否は access_denied で返り、コードは出ない', async () => {
    const verifier = randomSecret('')
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'cid_x',
      redirect_uri: REDIRECT,
      code_challenge: await s256(verifier),
      code_challenge_method: 'S256',
      state: 'st1',
    })
    // 未登録の client_id は、そもそもリダイレクトで返さない（踏み台にしない）。
    const unknown = await route(new Request(`${ORIGIN}/api/oauth/authorize?${query}`), [
      'authorize',
    ])
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('content-type')).toContain('text/html')

    const { rid } = await authorizeUpToCode(randomSecret(''))
    // 直前の許可で rid は使い切られているので、拒否は 404（期限切れ扱い）になる。
    const denied = await consent.onRequestPost({
      request: new Request(`${ORIGIN}/api/oauth/consent`, {
        method: 'POST',
        body: JSON.stringify({ rid, approve: false }),
      }),
      env,
    } as never)
    expect(denied.status).toBe(404)
  })
})

describe('自前の認可サーバー — 通してはいけない道', () => {
  it('認可コードは 1 回しか使えない', async () => {
    const verifier = randomSecret('')
    const { clientId, redirect } = await authorizeUpToCode(verifier)
    const code = redirect.searchParams.get('code') ?? ''
    expect((await exchange(clientId, code, verifier)).status).toBe(200)
    expect((await exchange(clientId, code, verifier)).status).toBe(400)
  })

  it('PKCE の verifier が違えば交換できない', async () => {
    const { clientId, redirect } = await authorizeUpToCode(randomSecret(''))
    const res = await exchange(clientId, redirect.searchParams.get('code') ?? '', 'wrong-verifier')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_grant' })
  })

  it('redirect_uri と client_id が交換時に食い違えば拒む', async () => {
    const verifier = randomSecret('')
    const { clientId, redirect } = await authorizeUpToCode(verifier)
    const code = redirect.searchParams.get('code') ?? ''
    expect((await exchange(clientId, code, verifier, 'https://evil.example/cb')).status).toBe(400)

    const again = await authorizeUpToCode(verifier)
    expect(
      (await exchange('cid_someoneelse', again.redirect.searchParams.get('code') ?? '', verifier))
        .status,
    ).toBe(400)
  })

  it('非会員は同意の時点で断る（押した先で汎用エラーにしない）', async () => {
    state.member = { userId: 'user_1', isMember: false }
    const verifier = randomSecret('')
    const reg = await route(
      post(
        'register',
        JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
        'application/json',
      ),
      ['register'],
    )
    const clientId = ((await reg.json()) as { client_id: string }).client_id
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: await s256(verifier),
      code_challenge_method: 'S256',
    })
    const auth = await route(new Request(`${ORIGIN}/api/oauth/authorize?${query}`), ['authorize'])
    const rid =
      new URLSearchParams((auth.headers.get('location') ?? '').split('?')[1]).get('rid') ?? ''

    const res = await consent.onRequestPost({
      request: new Request(`${ORIGIN}/api/oauth/consent`, {
        method: 'POST',
        body: JSON.stringify({ rid, approve: true }),
      }),
      env,
    } as never)
    expect(res.status).toBe(402)
    // 断ったのだからコードは 1 件も出ていない。
    expect(harness.rows('SELECT * FROM oauth_codes')).toHaveLength(0)
  })

  it('未ログインは同意画面の中身を返さない', async () => {
    state.member = null
    const res = await consent.onRequestGet({
      request: new Request(`${ORIGIN}/api/oauth/consent?rid=whatever`),
      env,
    } as never)
    expect(res.status).toBe(401)
  })
})
