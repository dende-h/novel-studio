import { describe, expect, it } from 'vitest'
import { PLAN_KEY } from './plan'
import { interpretBillingEvent } from './webhook-event'

// 代表的なペイロード形（フィールドパスは Slice F で Event Catalog に最終確認する想定）。
const endedOurPlan = (userId = 'user_1') => ({
  type: 'subscriptionItem.ended',
  data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: userId } },
})

describe('interpretBillingEvent（破壊的処理の単一判断点）', () => {
  it('有料プランの ended ＋ user payer は delete-account', () => {
    expect(interpretBillingEvent(endedOurPlan('user_42'))).toEqual({
      kind: 'delete-account',
      userId: 'user_42',
    })
  })

  it('無料/別プランの ended は ignore（昇格時の誤削除を防ぐ必須ガード）', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: 'free' }, payer: { type: 'user', user_id: 'u1' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'other_plan:free' })
  })

  it('canceled（期末解約予約・member 継続）は ignore', () => {
    const ev = {
      type: 'subscriptionItem.canceled',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: 'u1' } },
    }
    expect(interpretBillingEvent(ev).kind).toBe('ignore')
  })

  it('pastDue（支払い遅延・グレース中）は ignore', () => {
    const ev = {
      type: 'subscriptionItem.pastDue',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: 'u1' } },
    }
    expect(interpretBillingEvent(ev).kind).toBe('ignore')
  })

  it('organization payer は ignore（個人アカウントのみ対象）', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'organization', organization_id: 'org_1' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({
      kind: 'ignore',
      reason: 'payer_not_user:organization',
    })
  })

  it('user_id 欠落は ignore', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'no_user_id' })
  })

  it('空文字 user_id は ignore', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: '' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'no_user_id' })
  })

  it('空白のみ user_id は ignore（truthy だが無意味な値を弾く）', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: PLAN_KEY }, payer: { type: 'user', user_id: '   ' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'no_user_id' })
  })

  it('plan slug 欠落は ignore（安全側＝削除しない）', () => {
    const ev = { type: 'subscriptionItem.ended', data: { payer: { type: 'user', user_id: 'u1' } } }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'other_plan:none' })
  })

  it('data.plan_slug フォールバックでも解釈できる', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan_slug: PLAN_KEY, payer: { type: 'user', user_id: 'u9' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'delete-account', userId: 'u9' })
  })

  it('オブジェクトでない/型不正は ignore', () => {
    expect(interpretBillingEvent(null).kind).toBe('ignore')
    expect(interpretBillingEvent('x').kind).toBe('ignore')
    expect(interpretBillingEvent({ type: 'subscriptionItem.ended' })).toEqual({
      kind: 'ignore',
      reason: 'no_data',
    })
  })
})
