import { describe, expect, it } from 'vitest'
import { NEVER_PAID_MS, reapDeadline, shouldReap } from './reap-policy'

const DAY = 24 * 60 * 60 * 1000
const now = 1_000_000_000_000

describe('reap-policy', () => {
  it('会員は絶対に削除しない（猶予切れでも作成が古くても）', () => {
    expect(shouldReap({ isMember: true, graceUntil: 1, accountCreatedAt: 0, now })).toBe(false)
    expect(shouldReap({ isMember: true, graceUntil: 0, accountCreatedAt: 0, now })).toBe(false)
  })

  it('解約者：猶予切れなら削除・猶予中は残す', () => {
    expect(shouldReap({ isMember: false, graceUntil: now - DAY, accountCreatedAt: 0, now })).toBe(
      true,
    )
    expect(shouldReap({ isMember: false, graceUntil: now + DAY, accountCreatedAt: 0, now })).toBe(
      false,
    )
  })

  it('未課金（grace=0）：作成から NEVER_PAID_MS 経過で削除、それ未満は残す', () => {
    const old = now - NEVER_PAID_MS - DAY
    const recent = now - DAY
    expect(shouldReap({ isMember: false, graceUntil: 0, accountCreatedAt: old, now })).toBe(true)
    expect(shouldReap({ isMember: false, graceUntil: 0, accountCreatedAt: recent, now })).toBe(
      false,
    )
  })

  it('reapDeadline：猶予があれば猶予期限、無ければ作成+保持期間', () => {
    expect(reapDeadline({ graceUntil: 555, accountCreatedAt: 100 })).toBe(555)
    expect(reapDeadline({ graceUntil: 0, accountCreatedAt: 100 })).toBe(100 + NEVER_PAID_MS)
  })
})
