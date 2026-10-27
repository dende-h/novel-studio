// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubscriptionRow } from '../_lib/membership'
import { makeSubsDb } from '../_lib/subs-test-util'
import { onRequestPost } from './reap'

const purgeCloudData = vi.fn(async (_env: unknown, _userId: string) => {})
vi.mock('../_lib/purge', () => ({
  purgeCloudData: (env: unknown, userId: string) => purgeCloudData(env, userId),
}))

type Ctx = Parameters<typeof onRequestPost>[0]
const DAY = 86_400_000
const call = (db: D1Database, auth = 'Bearer s3cret') =>
  onRequestPost({
    request: new Request('https://x/api/billing/reap', {
      method: 'POST',
      headers: { authorization: auth },
    }),
    env: { DB: db, MEDIA: {} as R2Bucket, REAP_SECRET: 's3cret' },
  } as unknown as Ctx)

const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  user_id: 'u1',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  status: 'canceled',
  price_id: 'price_m',
  current_period_end: 0,
  grace_until: 0,
  updated_at: 1,
  ...over,
})

beforeEach(() => purgeCloudData.mockClear())

describe('reap（解約して猶予が切れた人のクラウドのデータを消す）', () => {
  it('合言葉が違えば何もしない', async () => {
    const { db } = makeSubsDb([row({ grace_until: Date.now() - DAY })])
    const res = await call(db, 'Bearer nope')
    expect(res.status).toBe(401)
    expect(purgeCloudData).not.toHaveBeenCalled()
  })

  it('猶予切れの解約者はクラウドのデータだけ消し、課金の履歴（subscriptions 行）は残す', async () => {
    const { db, rows } = makeSubsDb([row({ grace_until: Date.now() - DAY })])
    const res = await call(db)
    expect(await res.json()).toMatchObject({ ok: true, purged: 1 })
    expect(purgeCloudData).toHaveBeenCalledWith(expect.anything(), 'u1')
    // 行は消さない＝再購読時に 2 回目の無料トライアルを付けない。猶予は 0 に戻して二度目の対象から外す。
    expect(rows.get('u1')).toMatchObject({ status: 'canceled', grace_until: 0 })
  })

  it('猶予中の解約者・会員・一度も課金していない人は消さない', async () => {
    const { db } = makeSubsDb([
      row({ user_id: 'grace', grace_until: Date.now() + DAY }),
      row({ user_id: 'member', status: 'active' }),
      row({ user_id: 'never', status: 'incomplete', stripe_subscription_id: null }),
    ])
    const res = await call(db)
    expect(await res.json()).toMatchObject({ ok: true, purged: 0 })
    expect(purgeCloudData).not.toHaveBeenCalled()
  })

  it('対象を集めた後に再購読していたら消さない', async () => {
    const { db, rows } = makeSubsDb([row({ grace_until: Date.now() - DAY })])
    // 走査の直後に webhook が active へ書き換えた状況を作る。
    const prepare = db.prepare.bind(db)
    ;(db as { prepare: typeof db.prepare }).prepare = (sql: string) => {
      const stmt = prepare(sql)
      if (sql.includes('grace_until <= ?')) {
        const all = stmt.all.bind(stmt)
        stmt.all = (async () => {
          const r = await all()
          rows.set('u1', { ...row({}), status: 'active', grace_until: 0 })
          return r
        }) as typeof stmt.all
      }
      return stmt
    }
    const res = await call(db)
    expect(await res.json()).toMatchObject({ ok: true, purged: 0 })
    expect(purgeCloudData).not.toHaveBeenCalled()
  })
})
