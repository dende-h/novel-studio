// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 検証はモック。既定は会員。
vi.mock('../_lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/auth')>()
  return { ...actual, verifyMember: vi.fn(async () => ({ userId: 'user_1', isMember: true })) }
})

import { verifyMember } from '../_lib/auth'
import { hashMcpToken, resolveMcpUser } from '../_lib/mcp-token'
import { onRequestDelete, onRequestGet, onRequestPost } from './token'

const verifyMemberMock = vi.mocked(verifyMember)

/** mcp_tokens をエミュレートする fake D1（user_id 主キー＋token_hash 逆引き）。 */
function makeDb() {
  const rows = new Map<string, { user_id: string; token_hash: string; created_at: number }>()
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async run() {
          if (sql.startsWith('INSERT INTO mcp_tokens')) {
            const [user_id, token_hash, created_at] = args as [string, string, number]
            rows.set(user_id, { user_id, token_hash, created_at })
          } else if (sql.startsWith('DELETE FROM mcp_tokens')) {
            rows.delete(args[0] as string)
          }
          return {}
        },
        async first() {
          if (sql.includes('WHERE token_hash')) {
            const th = args[0] as string
            for (const r of rows.values()) if (r.token_hash === th) return { user_id: r.user_id }
            return null
          }
          const r = rows.get(args[0] as string)
          return r ? { created_at: r.created_at } : null
        },
      }
      return stmt
    },
  } as unknown as D1Database
  return { DB, rows }
}

type Ctx = Parameters<typeof onRequestPost>[0]
const ctx = (method: string, db: D1Database): Ctx =>
  ({
    request: new Request('https://x/api/mcp/token', { method }),
    env: { DB: db },
  }) as unknown as Ctx

beforeEach(() => {
  verifyMemberMock.mockClear()
  verifyMemberMock.mockResolvedValue({ userId: 'user_1', isMember: true })
})

describe('POST/GET/DELETE /api/mcp/token', () => {
  it('POST は平文トークンを返し、ハッシュから user を解決できる（平文は保存しない）', async () => {
    const { DB, rows } = makeDb()
    const res = await onRequestPost(ctx('POST', DB))
    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    expect(token.startsWith('mcp_')).toBe(true)
    // 保存されているのはハッシュのみ。
    const stored = rows.get('user_1')
    expect(stored?.token_hash).toBe(await hashMcpToken(token))
    expect(stored?.token_hash).not.toBe(token)
    // ハッシュから user を解決できる（MCP エンドポイントの認証）。
    expect(await resolveMcpUser(DB, token)).toBe('user_1')
    expect(await resolveMcpUser(DB, 'mcp_wrong')).toBeNull()
  })

  it('GET は発行済みかを返す（平文は返さない）', async () => {
    const { DB } = makeDb()
    expect((await (await onRequestGet(ctx('GET', DB))).json()) as unknown).toEqual({
      hasToken: false,
      createdAt: null,
    })
    await onRequestPost(ctx('POST', DB))
    const got = (await (await onRequestGet(ctx('GET', DB))).json()) as {
      hasToken: boolean
      createdAt: number
    }
    expect(got.hasToken).toBe(true)
    expect(typeof got.createdAt).toBe('number')
  })

  it('DELETE で失効する（以降 GET は未発行・トークンも解決不可）', async () => {
    const { DB } = makeDb()
    const { token } = (await (await onRequestPost(ctx('POST', DB))).json()) as { token: string }
    await onRequestDelete(ctx('DELETE', DB))
    expect(await resolveMcpUser(DB, token)).toBeNull()
    expect(
      ((await (await onRequestGet(ctx('GET', DB))).json()) as { hasToken: boolean }).hasToken,
    ).toBe(false)
  })

  it('未認証は 401・未課金は 402（発行しない）', async () => {
    const { DB, rows } = makeDb()
    verifyMemberMock.mockResolvedValueOnce(null)
    expect((await onRequestPost(ctx('POST', DB))).status).toBe(401)
    verifyMemberMock.mockResolvedValueOnce({ userId: 'u', isMember: false })
    expect((await onRequestPost(ctx('POST', DB))).status).toBe(402)
    expect(rows.size).toBe(0)
  })
})
