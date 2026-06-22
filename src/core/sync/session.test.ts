import { describe, expect, it } from 'vitest'
import { type ActiveSession, claimSession, isSessionCurrent } from './session'

const row = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  userId: 'user_1',
  sessionToken: 'tok_a',
  rotatedAt: 1000,
  ...over,
})

describe('isSessionCurrent（単一アクティブセッションの照合）', () => {
  it('active が null なら false（未 claim）', () => {
    expect(isSessionCurrent(null, 'user_1', 'tok_a')).toBe(false)
  })

  it('ユーザーが一致しなければ false', () => {
    expect(isSessionCurrent(row(), 'user_2', 'tok_a')).toBe(false)
  })

  it('提示トークンが空なら false（偶発一致を防ぐ）', () => {
    expect(isSessionCurrent(row({ sessionToken: '' }), 'user_1', '')).toBe(false)
  })

  it('トークンが一致しなければ false（別端末に奪われた）', () => {
    expect(isSessionCurrent(row({ sessionToken: 'tok_new' }), 'user_1', 'tok_a')).toBe(false)
  })

  it('ユーザーもトークンも一致すれば true', () => {
    expect(isSessionCurrent(row(), 'user_1', 'tok_a')).toBe(true)
  })
})

describe('claimSession（セッション奪取時の行生成）', () => {
  it('userId・新トークン・時刻を持つ行を返す', () => {
    expect(claimSession('user_1', 'tok_z', 1234)).toEqual({
      userId: 'user_1',
      sessionToken: 'tok_z',
      rotatedAt: 1234,
    })
  })

  it('生成した行は同じトークンの提示にだけ一致する（旧トークンは無効化）', () => {
    const claimed = claimSession('user_1', 'tok_z', 1234)
    expect(isSessionCurrent(claimed, 'user_1', 'tok_z')).toBe(true)
    expect(isSessionCurrent(claimed, 'user_1', 'tok_a')).toBe(false)
  })
})
