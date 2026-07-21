import { beforeAll, describe, expect, it } from 'vitest'
import { bearerOf, resolveMcpAuth, verifyOAuthUserId } from './mcp-auth'
import { hashMcpToken } from './mcp-token'

const ISS = 'https://clerk.example.com'
const AUD = 'https://x/api/mcp'
const NOW = 1_800_000_000_000

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))

let priv: CryptoKey
let jwk: JsonWebKey
const getJwks = async () => [jwk]

async function makeJwt(payload: Record<string, unknown>): Promise<string> {
  const h = b64urlJson({ alg: 'RS256', kid: 'k' })
  const p = b64urlJson(payload)
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(`${h}.${p}`)),
  )
  return `${h}.${p}.${b64url(sig)}`
}
const base = () => ({ sub: 'user_1', iss: ISS, aud: AUD, exp: Math.floor(NOW / 1000) + 3600 })

/** mcp_tokens をエミュレートする fake D1（token_hash → user_id）。 */
function fakeDb(rows: Map<string, string>) {
  return {
    prepare: (_sql: string) => ({
      bind: (hash: string) => ({
        first: async () => {
          const uid = rows.get(hash)
          return uid ? { user_id: uid } : null
        },
      }),
    }),
  } as unknown as D1Database
}

const req = (auth?: string) =>
  new Request('https://x/api/mcp', { headers: auth ? { Authorization: auth } : {} })

describe('mcp-auth（二系統トークン解決）', () => {
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    priv = pair.privateKey
    jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
    jwk.kid = 'k'
  })

  it('bearerOf は Bearer トークンを取り出す', () => {
    expect(bearerOf(req('Bearer abc'))).toBe('abc')
    expect(bearerOf(req())).toBe('')
  })

  it('OAuth 未設定（結線前）は verifyOAuthUserId が null', async () => {
    const token = await makeJwt(base())
    expect(await verifyOAuthUserId(token, {}, { getJwks, now: NOW })).toBeNull()
  })

  it('OAuth 設定済み：妥当なトークンは sub(userId) を返す', async () => {
    const token = await makeJwt(base())
    const uid = await verifyOAuthUserId(
      token,
      { MCP_OAUTH_ISSUER: ISS, MCP_OAUTH_AUDIENCE: AUD },
      { getJwks, now: NOW },
    )
    expect(uid).toBe('user_1')
  })

  it('resolveMcpAuth：mcp_ トークンは D1 で解決し via=token', async () => {
    const rows = new Map([[await hashMcpToken('mcp_secret'), 'user_9']])
    const p = await resolveMcpAuth(req('Bearer mcp_secret'), {}, fakeDb(rows))
    expect(p).toMatchObject({ userId: 'user_9', via: 'token', isMember: true })
  })

  it('resolveMcpAuth：未知の mcp_ トークンは null', async () => {
    const p = await resolveMcpAuth(req('Bearer mcp_unknown'), {}, fakeDb(new Map()))
    expect(p).toBeNull()
  })

  it('resolveMcpAuth：OAuth 有効なら JWT を優先し、会員照会の結果を isMember に載せる', async () => {
    const token = await makeJwt(base())
    const p = await resolveMcpAuth(
      req(`Bearer ${token}`),
      { MCP_OAUTH_ISSUER: ISS, MCP_OAUTH_AUDIENCE: AUD },
      fakeDb(new Map()),
      { getJwks, now: NOW, isMember: async () => true },
    )
    expect(p).toMatchObject({ userId: 'user_1', via: 'oauth', isMember: true })
  })

  it('resolveMcpAuth：OAuth トークンでも会員照会が false なら isMember=false', async () => {
    const token = await makeJwt(base())
    const p = await resolveMcpAuth(
      req(`Bearer ${token}`),
      { MCP_OAUTH_ISSUER: ISS, MCP_OAUTH_AUDIENCE: AUD },
      fakeDb(new Map()),
      { getJwks, now: NOW, isMember: async () => false },
    )
    expect(p).toMatchObject({ userId: 'user_1', via: 'oauth', isMember: false })
  })

  it('resolveMcpAuth：トークン無しは null', async () => {
    expect(await resolveMcpAuth(req(), {}, fakeDb(new Map()))).toBeNull()
  })
})
