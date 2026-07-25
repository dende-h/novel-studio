import { describe, expect, it } from 'vitest'
import { bearerOf, resolveMcpAuth } from './mcp-auth'
import { hashMcpToken } from './mcp-token'

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
const env = { CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' }

describe('mcp-auth（二系統トークン解決）', () => {
  it('bearerOf は Bearer トークンを取り出す', () => {
    expect(bearerOf(req('Bearer abc'))).toBe('abc')
    expect(bearerOf(req())).toBe('')
  })

  it('mcp_ トークンは D1 で解決し via=token・会員なら isMember=true', async () => {
    const rows = new Map([[await hashMcpToken('mcp_secret'), 'user_9']])
    const p = await resolveMcpAuth(req('Bearer mcp_secret'), env, fakeDb(rows), {
      isMember: async () => true,
    })
    expect(p).toMatchObject({ userId: 'user_9', via: 'token', isMember: true })
  })

  it('mcp_ トークンでも失効（非会員）なら isMember=false（呼び出し側で 403）', async () => {
    const rows = new Map([[await hashMcpToken('mcp_secret'), 'user_9']])
    const p = await resolveMcpAuth(req('Bearer mcp_secret'), env, fakeDb(rows), {
      isMember: async () => false,
    })
    expect(p).toMatchObject({ userId: 'user_9', via: 'token', isMember: false })
  })

  it('未知の mcp_ トークンは null', async () => {
    const p = await resolveMcpAuth(req('Bearer mcp_unknown'), env, fakeDb(new Map()))
    expect(p).toBeNull()
  })

  it('OAuth：検証が userId を返し、会員照会 true なら via=oauth・member', async () => {
    const p = await resolveMcpAuth(req('Bearer oat_xxx'), env, fakeDb(new Map()), {
      verifyOAuth: async () => 'user_1',
      isMember: async () => true,
    })
    expect(p).toMatchObject({ userId: 'user_1', via: 'oauth', isMember: true })
  })

  it('OAuth：会員照会が false なら isMember=false（呼び出し側で 403）', async () => {
    const p = await resolveMcpAuth(req('Bearer oat_xxx'), env, fakeDb(new Map()), {
      verifyOAuth: async () => 'user_1',
      isMember: async () => false,
    })
    expect(p).toMatchObject({ userId: 'user_1', via: 'oauth', isMember: false })
  })

  it('OAuth：検証が null なら null', async () => {
    const p = await resolveMcpAuth(req('Bearer oat_xxx'), env, fakeDb(new Map()), {
      verifyOAuth: async () => null,
    })
    expect(p).toBeNull()
  })

  it('トークン無しは null', async () => {
    expect(await resolveMcpAuth(req(), env, fakeDb(new Map()))).toBeNull()
  })
})
