import { describe, expect, it } from 'vitest'
import { PLAN_KEY } from './plan'
import { interpretBillingEvent } from './webhook-event'

// 実 subscriptionItem.ended ペイロード形（Slice F で Clerk Testing タブに照合済み）。
// payer は commerce_payer で、個人払いは organization_id が空文字・user_id が入る（type フィールドは無い）。
const endedOurPlan = (userId = 'user_1', slug: string = PLAN_KEY) => ({
  type: 'subscriptionItem.ended',
  data: {
    object: 'subscription_item',
    status: 'ended',
    plan: { slug, name: 'クラウド追加' },
    payer: { object: 'commerce_payer', organization_id: '', user_id: userId },
  },
})

describe('interpretBillingEvent（破壊的処理の単一判断点）', () => {
  it('有料プランの ended ＋ user payer は delete-account', () => {
    expect(interpretBillingEvent(endedOurPlan('user_42'))).toEqual({
      kind: 'delete-account',
      userId: 'user_42',
    })
  })

  it('実ペイロード形（commerce_payer・extra フィールド込み）を正しく解釈する', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: {
        id: 'csub_item_x',
        object: 'subscription_item',
        status: 'ended',
        plan_id: 'cplan_x',
        plan: { id: 'cplan_x', name: 'クラウド追加', slug: PLAN_KEY, currency: 'USD' },
        payer: {
          object: 'commerce_payer',
          organization_id: '',
          user_id: 'user_real',
          email: 'a@b.c',
        },
      },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'delete-account', userId: 'user_real' })
  })

  it('無料/別プランの ended は ignore（昇格時の誤削除を防ぐ必須ガード）', () => {
    expect(interpretBillingEvent(endedOurPlan('u1', 'free_user'))).toEqual({
      kind: 'ignore',
      reason: 'other_plan:free_user',
    })
  })

  it('canceled（期末解約予約・member 継続）は ignore', () => {
    const ev = { ...endedOurPlan('u1'), type: 'subscriptionItem.canceled' }
    expect(interpretBillingEvent(ev).kind).toBe('ignore')
  })

  it('pastDue（支払い遅延・グレース中）は ignore', () => {
    const ev = { ...endedOurPlan('u1'), type: 'subscriptionItem.pastDue' }
    expect(interpretBillingEvent(ev).kind).toBe('ignore')
  })

  it('organization 払い（organization_id あり）は ignore（個人アカウントのみ対象）', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: {
        plan: { slug: PLAN_KEY },
        payer: { object: 'commerce_payer', organization_id: 'org_1', user_id: '' },
      },
    }
    expect(interpretBillingEvent(ev)).toEqual({
      kind: 'ignore',
      reason: 'payer_organization:org_1',
    })
  })

  it('user_id 欠落は ignore', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { plan: { slug: PLAN_KEY }, payer: { object: 'commerce_payer', organization_id: '' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'no_user_id' })
  })

  it('空文字 user_id は ignore', () => {
    expect(interpretBillingEvent(endedOurPlan(''))).toEqual({
      kind: 'ignore',
      reason: 'no_user_id',
    })
  })

  it('空白のみ user_id は ignore（truthy だが無意味な値を弾く）', () => {
    expect(interpretBillingEvent(endedOurPlan('   '))).toEqual({
      kind: 'ignore',
      reason: 'no_user_id',
    })
  })

  it('plan slug 欠落は ignore（安全側＝削除しない）', () => {
    const ev = {
      type: 'subscriptionItem.ended',
      data: { payer: { object: 'commerce_payer', organization_id: '', user_id: 'u1' } },
    }
    expect(interpretBillingEvent(ev)).toEqual({ kind: 'ignore', reason: 'other_plan:none' })
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
