// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { onRequest } from './[[path]]'

const ISSUER = 'https://credible-stork-66.clerk.accounts.dev'
const AS_DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  registration_endpoint: `${ISSUER}/oauth/register`,
}

interface Call {
  url: string
  init?: RequestInit
}

/** 上流(Clerk)を差し替える。AS メタデータは常に返し、窓口は respond で決める。 */
function stubUpstream(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return new Response(JSON.stringify(AS_DOC), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return respond(url, init)
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = real) }
}

/** Pages の context を最小限で模す（このルートが読むのは request / env / params だけ）。 */
type Ctx = Parameters<typeof onRequest>[0]
const call = (request: Request, path: string[], env: Record<string, string> = {}) =>
  onRequest({ request, env, params: { path } } as unknown as Ctx)

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

describe('/api/oauth/*（認可サーバー窓口）', () => {
  it('authorize は Clerk へ 302 し、クエリ（PKCE・resource）を素通しする', async () => {
    const s = stubUpstream(() => new Response('unexpected', { status: 500 }))
    restore = s.restore
    const url =
      'https://stg.example.pages.dev/api/oauth/authorize' +
      '?client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcb&code_challenge=abc' +
      '&code_challenge_method=S256&resource=https%3A%2F%2Fstg.example.pages.dev%2Fapi%2Fmcp'
    const res = await call(new Request(url), ['authorize'], { MCP_OAUTH_ISSUER: ISSUER })

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(`${ISSUER}/oauth/authorize`)
    expect(location.searchParams.get('client_id')).toBe('c1')
    expect(location.searchParams.get('redirect_uri')).toBe('https://chatgpt.com/cb')
    expect(location.searchParams.get('code_challenge')).toBe('abc')
    expect(location.searchParams.get('resource')).toBe('https://stg.example.pages.dev/api/mcp')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('token は 302 でなくサーバー側中継で、本文と状態をそのまま返す', async () => {
    const s = stubUpstream(
      () =>
        new Response(JSON.stringify({ access_token: 'at_1', token_type: 'Bearer' }), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    restore = s.restore
    const body = 'grant_type=authorization_code&code=xyz&code_verifier=v1'
    const res = await call(
      new Request('https://stg.example.pages.dev/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
      ['token'],
      { MCP_OAUTH_ISSUER: ISSUER },
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: 'at_1', token_type: 'Bearer' })
    const forwarded = s.calls.find((c) => c.url === `${ISSUER}/oauth/token`)
    expect(forwarded).toBeTruthy()
    expect(forwarded?.init?.method).toBe('POST')
    expect(new TextDecoder().decode(forwarded?.init?.body as ArrayBuffer)).toBe(body)
  })

  it('中継では Cookie を上流へ渡さない', async () => {
    const s = stubUpstream(() => new Response('{}', { headers: { 'content-type': 'text/json' } }))
    restore = s.restore
    await call(
      new Request('https://stg.example.pages.dev/api/oauth/token', {
        method: 'POST',
        headers: { cookie: '__session=secret', authorization: 'Basic zzz' },
        body: 'grant_type=refresh_token',
      }),
      ['token'],
      { MCP_OAUTH_ISSUER: ISSUER },
    )
    const forwarded = s.calls.find((c) => c.url === `${ISSUER}/oauth/token`)
    const headers = new Headers(forwarded?.init?.headers)
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBe('Basic zzz')
  })

  it('上流のエラー応答（invalid_grant 等）を状態ごと返す', async () => {
    const s = stubUpstream(
      () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    )
    restore = s.restore
    const res = await call(
      new Request('https://stg.example.pages.dev/api/oauth/token', { method: 'POST', body: 'x' }),
      ['token'],
      { MCP_OAUTH_ISSUER: ISSUER },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_grant' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('上流に無い窓口は 503（メタデータにも出していない）', async () => {
    const s = stubUpstream(() => new Response('unexpected', { status: 500 }))
    restore = s.restore
    const res = await call(
      new Request('https://stg.example.pages.dev/api/oauth/revoke', { method: 'POST' }),
      ['revoke'],
      { MCP_OAUTH_ISSUER: ISSUER },
    )
    expect(res.status).toBe(503)
  })

  it('MCP_OAUTH_ISSUER 未設定なら 503・知らない窓口は 404', async () => {
    const s = stubUpstream(() => new Response('unexpected', { status: 500 }))
    restore = s.restore
    const unset = await call(
      new Request('https://stg.example.pages.dev/api/oauth/token', { method: 'POST' }),
      ['token'],
    )
    expect(unset.status).toBe(503)
    const unknown = await call(
      new Request('https://stg.example.pages.dev/api/oauth/nope'),
      ['nope'],
      { MCP_OAUTH_ISSUER: ISSUER },
    )
    expect(unknown.status).toBe(404)
  })
})
