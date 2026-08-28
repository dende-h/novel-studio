import { describe, expect, it } from 'vitest'
import { reapDeadline, shouldReap } from './reap-policy'

const DAY = 24 * 60 * 60 * 1000
const now = 1_000_000_000_000

describe('reap-policy', () => {
  it('会員は絶対に削除しない（猶予切れでも）', () => {
    expect(shouldReap({ isMember: true, graceUntil: 1, now })).toBe(false)
    expect(shouldReap({ isMember: true, graceUntil: 0, now })).toBe(false)
  })

  it('解約者：猶予切れなら削除・猶予中は残す', () => {
    expect(shouldReap({ isMember: false, graceUntil: now - DAY, now })).toBe(true)
    expect(shouldReap({ isMember: false, graceUntil: now + DAY, now })).toBe(false)
  })

  it('未課金（grace=0）は削除しない — 無料アカウントに期限は無い', () => {
    // 登録から何年経っていても消さない。free は正当な状態で、構想の道具も掲示板も
    // 無料アカウントに開いている（derive-status.ts / Root.tsx / 09-board.md）。
    expect(shouldReap({ isMember: false, graceUntil: 0, now })).toBe(false)
    expect(shouldReap({ isMember: false, graceUntil: 0, now: now + 3650 * DAY })).toBe(false)
  })

  it('reapDeadline：猶予があれば猶予期限、無ければ 0（＝削除の予定なし）', () => {
    expect(reapDeadline({ graceUntil: 555 })).toBe(555)
    expect(reapDeadline({ graceUntil: 0 })).toBe(0)
  })
})
