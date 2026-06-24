// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 検証はモック。既定は会員（isMember=true）。未課金/未認証は mockResolvedValueOnce で差し替える。
vi.mock('../_lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/auth')>()
  return { ...actual, verifyMember: vi.fn(async () => ({ userId: 'user_1', isMember: true })) }
})

import { verifyMember } from '../_lib/auth'
import { onRequestGet } from './manifest'

const verifyMemberMock = vi.mocked(verifyMember)

interface ManifestRow {
  work_id: string
  updated_at: number
  deleted: number
  doc_hash: string
  media_hash: string
  size: number
}

function makeDb(rows: ManifestRow[]): D1Database {
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt
        },
        async all() {
          return { results: rows }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

let env: { DB: D1Database; CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string }

beforeEach(() => {
  env = { DB: makeDb([]), CLERK_SECRET_KEY: 'x', CLERK_PUBLISHABLE_KEY: 'x' }
})

type Ctx = Parameters<typeof onRequestGet>[0]
const ctx = (): Ctx =>
  ({ request: new Request('https://x/api/sync/manifest'), env }) as unknown as Ctx

describe('GET /api/sync/manifest — 課金・認証ゲート', () => {
  it('未認証（verifyMember=null）は 401', async () => {
    verifyMemberMock.mockResolvedValueOnce(null)
    expect((await onRequestGet(ctx())).status).toBe(401)
  })

  it('未課金（isMember=false）は 402', async () => {
    verifyMemberMock.mockResolvedValueOnce({ userId: 'user_1', isMember: false })
    expect((await onRequestGet(ctx())).status).toBe(402)
  })

  it('会員は 200 で D1 行を ManifestEntry に整形して返す', async () => {
    env.DB = makeDb([
      { work_id: 'w1', updated_at: 100, deleted: 0, doc_hash: 'd', media_hash: 'm', size: 42 },
    ])
    const res = await onRequestGet(ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: Array<Record<string, unknown>> }
    expect(body.entries).toEqual([
      { workId: 'w1', updatedAt: 100, deleted: false, docHash: 'd', mediaHash: 'm', size: 42 },
    ])
  })
})
