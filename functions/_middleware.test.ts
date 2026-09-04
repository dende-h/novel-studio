// @vitest-environment node
/**
 * ディスカバリの契約を機械で固定する。ここが崩れると **接続できたクライアントが黙って切れる**——
 * しかもエラーはクライアント側にしか出ないので、こちらからは気づけない。
 *
 * とくに「自オリジンを認可サーバーとして名乗らない」は、名乗った結果 ChatGPT が繋がらなくなった
 * 実績のある一線（docs/requirement/10-mcp-oauth.md §2-A）。回帰したらここで止める。
 */
import { describe, expect, it } from 'vitest'
import { onRequest } from './_middleware'

const ISSUER = 'https://credible-stork-66.clerk.accounts.dev'
const ORIGIN = 'https://stg.novel-studio-b2m.pages.dev'

type Ctx = Parameters<typeof onRequest>[0]

/** ミドルウェアを 1 回通す。next は「素通しで来た」ことが分かる応答を返す。 */
const call = (path: string, env: Record<string, string> = {}, method = 'GET', origin = ORIGIN) =>
  onRequest({
    request: new Request(`${origin}${path}`, { method }),
    env,
    next: async () =>
      new Response('<!doctype html><title>app</title>', {
        headers: { 'content-type': 'text/html' },
      }),
  } as unknown as Ctx)

describe('OAuth ディスカバリ', () => {
  it('PRM は Clerk の issuer を認可サーバーとして指す（自オリジンを名乗らない）', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ]) {
      const res = await call(path, { MCP_OAUTH_ISSUER: ISSUER })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      const doc = (await res.json()) as Record<string, unknown>
      expect(doc.resource).toBe(`${ORIGIN}/api/mcp`)
      expect(doc.authorization_servers).toEqual([ISSUER])
      expect(doc.bearer_methods_supported).toEqual(['header'])
    }
  })

  it('末尾スラッシュ付きの issuer も落として指す', async () => {
    const res = await call('/.well-known/oauth-protected-resource', {
      MCP_OAUTH_ISSUER: `${ISSUER}/`,
    })
    const doc = (await res.json()) as { authorization_servers: string[] }
    expect(doc.authorization_servers).toEqual([ISSUER])
  })

  it('scopes は設定したときだけ出す', async () => {
    const withScopes = await call('/.well-known/oauth-protected-resource', {
      MCP_OAUTH_ISSUER: ISSUER,
      MCP_OAUTH_SCOPES: 'openid  profile',
    })
    expect(((await withScopes.json()) as Record<string, unknown>).scopes_supported).toEqual([
      'openid',
      'profile',
    ])
    const without = await call('/.well-known/oauth-protected-resource', {
      MCP_OAUTH_ISSUER: ISSUER,
    })
    expect('scopes_supported' in (await without.json())).toBe(false)
  })

  it('issuer 未設定なら認可サーバーを名乗らない（空配列・HTML には落とさない）', async () => {
    const res = await call('/.well-known/oauth-protected-resource')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { authorization_servers: string[] }
    expect(doc.authorization_servers).toEqual([])
  })

  it('AS メタデータは JSON の 404（自オリジンを認可サーバーとして名乗らない）', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
    ]) {
      const res = await call(path, { MCP_OAUTH_ISSUER: ISSUER })
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(res.headers.get('cache-control')).toBe('no-store')
      // 誤って上流の内容や自オリジンの窓口を配っていないこと。
      expect(await res.text()).not.toContain('issuer')
    }
  })

  it('OPTIONS は CORS だけ返す', async () => {
    const res = await call('/.well-known/oauth-protected-resource', {}, 'OPTIONS')
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('ディスカバリ以外は素通しする', async () => {
    const res = await call('/api/mcp', { MCP_OAUTH_ISSUER: ISSUER }, 'POST')
    expect(res.headers.get('content-type')).toBe('text/html')
  })
})

describe('noindex（本番ドメインを検索から消さない）', () => {
  it('*.pages.dev には noindex を付ける', async () => {
    const res = await call('/', { MCP_OAUTH_ISSUER: ISSUER })
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('本番ドメインには付けない', async () => {
    const res = await call('/', { MCP_OAUTH_ISSUER: ISSUER }, 'GET', 'https://cotonoha-leaf.org')
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
  })
})
