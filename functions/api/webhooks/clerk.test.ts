// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// verifySvix は既定で実装そのまま（実 crypto で検証）。署名・期限切れ・無効署名をエンドツーエンドで通す。
vi.mock('../_lib/svix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/svix')>()
  return { verifySvix: vi.fn(actual.verifySvix) }
})

// Clerk users.deleteUser をモック（実 API は叩かない）。
const deleteUser = vi.fn(async () => ({}))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { deleteUser } }),
}))

import { PLAN_KEY } from '../../../src/core/billing/plan'
import { verifySvix } from '../_lib/svix'
// verifySvix と同じ規約で実署名を作る共有ヘルパ（テストは本物の HMAC で検証する）。
import { signSvix as sign } from '../_lib/svix-test-util'
import { onRequestPost } from './clerk'

const verifySvixMock = vi.mocked(verifySvix)

const SECRET = `whsec_${btoa('0123456789abcdef0123456789abcdef')}`

/** R2/D1 のスパイ付きフェイク env を作る。R2 は 2 ページ（truncated を辿る）を返す。 */
function makeEnv() {
  const r2Deleted: string[][] = []
  const listCalls: Array<{ prefix?: string; cursor?: string }> = []
  const dbStatements: Array<{ sql: string; binds: unknown[] }> = []

  let listIdx = 0
  const pages = [
    {
      objects: [{ key: 'user_42/w1/doc' }, { key: 'user_42/w1/media' }],
      truncated: true,
      cursor: 'c1',
    },
    { objects: [{ key: 'user_42/w2/doc' }], truncated: false },
  ]

  const MEDIA = {
    async list(opts: { prefix?: string; cursor?: string }) {
      listCalls.push(opts)
      return pages[listIdx++] ?? { objects: [], truncated: false }
    },
    async delete(keys: string[]) {
      r2Deleted.push(keys)
    },
  } as unknown as R2Bucket

  const DB = {
    prepare(sql: string) {
      const binds: unknown[] = []
      const stmt = {
        sql,
        binds,
        bind(...args: unknown[]) {
          binds.push(...args)
          return stmt
        },
        async run() {
          dbStatements.push({ sql, binds })
          return {}
        },
      }
      return stmt
    },
    // 本番は env.DB.batch([...])（1 往復・暗黙トランザクション）。fake は順番どおり記録する。
    async batch(stmts: Array<{ sql: string; binds: unknown[] }>) {
      for (const s of stmts) dbStatements.push({ sql: s.sql, binds: s.binds })
      return stmts.map(() => ({}))
    },
  } as unknown as D1Database

  const env = {
    DB,
    MEDIA,
    CLERK_SECRET_KEY: 'sk',
    CLERK_PUBLISHABLE_KEY: 'pk',
    CLERK_WEBHOOK_SECRET: SECRET,
  }
  return { env, r2Deleted, listCalls, dbStatements }
}

type Ctx = Parameters<typeof onRequestPost>[0]

/** 実署名付きの POST コンテキストを作る。badSig=true で署名を壊す、tsOffsetSec で時刻をずらす。 */
async function ctx(
  body: unknown,
  env: unknown,
  opts: { badSig?: boolean; tsOffsetSec?: number } = {},
): Promise<Ctx> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const id = 'msg_1'
  const ts = String(Math.floor(Date.now() / 1000) + (opts.tsOffsetSec ?? 0))
  const signature = opts.badSig ? 'v1,AAAA' : `v1,${await sign(SECRET, id, ts, raw)}`
  const init: RequestInit = {
    method: 'POST',
    body: raw,
    headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature },
  }
  return { request: new Request('https://x/api/webhooks/clerk', init), env } as unknown as Ctx
}

const endedEvent = (userId = 'user_42', slug = PLAN_KEY) => ({
  type: 'subscriptionItem.ended',
  data: {
    plan: { slug },
    payer: { object: 'commerce_payer', organization_id: '', user_id: userId },
  },
})

beforeEach(() => {
  deleteUser.mockClear()
  deleteUser.mockResolvedValue({})
  verifySvixMock.mockClear() // 実装（実 crypto 委譲）は保持し、呼び出し履歴だけクリア。
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/webhooks/clerk（失効→クラウド削除）', () => {
  it('CLERK_WEBHOOK_SECRET 未設定は 500 で署名検証も削除も行わない', async () => {
    const { env } = makeEnv()
    const res = await onRequestPost(
      await ctx(endedEvent(), { ...env, CLERK_WEBHOOK_SECRET: undefined }),
    )
    expect(res.status).toBe(500)
    expect(verifySvixMock).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('署名が無効なら 401 で削除しない（実 crypto 検証）', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent(), env, { badSig: true }))
    expect(res.status).toBe(401)
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('タイムスタンプが許容外なら 401 で削除しない（実 crypto 検証・リプレイ拒否）', async () => {
    const { env, r2Deleted } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent(), env, { tsOffsetSec: -600 }))
    expect(res.status).toBe(401)
    expect(r2Deleted).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('秘密鍵が不正（検証が例外）なら 500 で削除しない', async () => {
    const { env, r2Deleted } = makeEnv()
    // 不正な base64（'!!!'）で atob が throw → ハンドラが捕捉して 500（破壊処理せず）。
    const res = await onRequestPost(
      await ctx(endedEvent(), { ...env, CLERK_WEBHOOK_SECRET: 'whsec_!!!' }),
    )
    expect(res.status).toBe(500)
    expect(r2Deleted).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('署名は有効だが本文が JSON でないなら 400', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx('not-json{', env))
    expect(res.status).toBe(400)
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('有料プランの ended は R2／D1／Clerk を削除し 200', async () => {
    const { env, r2Deleted, listCalls, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent('user_42'), env))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 'user_42' })

    // R2: 2 ページを辿って全ブロブ削除。
    expect(listCalls).toEqual([
      { prefix: 'user_42/', cursor: undefined },
      { prefix: 'user_42/', cursor: 'c1' },
    ])
    expect(r2Deleted.flat()).toEqual(['user_42/w1/doc', 'user_42/w1/media', 'user_42/w2/doc'])

    // D1: works / sessions / rate_limits を userId で削除。
    expect(dbStatements.map((s) => s.sql)).toEqual([
      'DELETE FROM works WHERE user_id = ?',
      'DELETE FROM sessions WHERE user_id = ?',
      'DELETE FROM rate_limits WHERE user_id = ?',
    ])
    for (const s of dbStatements) expect(s.binds).toEqual(['user_42'])

    // Clerk ユーザー削除。
    expect(deleteUser).toHaveBeenCalledWith('user_42')
  })

  it('無料プランの ended（昇格時に発火）は 200・何も削除しない（誤削除ガードの統合確認）', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent('user_42', 'free'), env))
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ ok: true })
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('organization 払いの ended は 200・何も削除しない', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const ev = {
      type: 'subscriptionItem.ended',
      data: {
        plan: { slug: PLAN_KEY },
        payer: { object: 'commerce_payer', organization_id: 'org_1', user_id: '' },
      },
    }
    const res = await onRequestPost(await ctx(ev, env))
    expect(res.status).toBe(200)
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('空文字 user_id の ended は 200・何も削除しない', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent(''), env))
    expect(res.status).toBe(200)
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('対象外イベント（canceled）は 200・何も削除しない', async () => {
    const { env, r2Deleted, dbStatements } = makeEnv()
    const ev = {
      type: 'subscriptionItem.canceled',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: 'user_42' } },
    }
    const res = await onRequestPost(await ctx(ev, env))
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ ok: true })
    expect(r2Deleted).toHaveLength(0)
    expect(dbStatements).toHaveLength(0)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('Clerk が 404（既に削除済み）なら冪等に 200・データ削除は完了', async () => {
    deleteUser.mockRejectedValueOnce({ status: 404 })
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent('user_42'), env))
    expect(res.status).toBe(200)
    expect(r2Deleted.flat()).toContain('user_42/w1/doc')
    expect(dbStatements).toHaveLength(3)
  })

  it('Clerk が 404 以外で失敗したら 500（再送で再試行）・データ削除は実行済み', async () => {
    deleteUser.mockRejectedValueOnce({ status: 500 })
    const { env, r2Deleted, dbStatements } = makeEnv()
    const res = await onRequestPost(await ctx(endedEvent('user_42'), env))
    expect(res.status).toBe(500)
    expect(r2Deleted.flat()).toContain('user_42/w1/doc')
    expect(dbStatements).toHaveLength(3)
  })

  it('R2 削除が失敗したら 500・Clerk 削除は呼ばれない（再送で再試行）', async () => {
    const { env } = makeEnv()
    env.MEDIA.delete = (async () => {
      throw new Error('r2 down')
    }) as unknown as R2Bucket['delete']
    const res = await onRequestPost(await ctx(endedEvent('user_42'), env))
    expect(res.status).toBe(500)
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
