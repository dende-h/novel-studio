import { describe, expect, it } from 'vitest'
import { deriveStatus } from './derive-status'

describe('deriveStatus（Clerk 状態 → 認証ステータス）', () => {
  it('未ロードは loading（ちらつき防止）', () => {
    expect(deriveStatus({ isLoaded: false, isSignedIn: false, hasPlan: false })).toBe('loading')
    // ロード前は他のフラグに関係なく loading。
    expect(deriveStatus({ isLoaded: false, isSignedIn: true, hasPlan: true })).toBe('loading')
  })

  it('未サインインは guest', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: false, hasPlan: false })).toBe('guest')
  })

  it('サインイン済みだが未課金は guest（同期オフ）', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: false })).toBe('guest')
  })

  it('サインイン済み かつ 課金は member（同期有効）', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: true })).toBe('member')
  })

  it('未サインインで課金クレームだけある異常系は guest（サインインを優先）', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: false, hasPlan: true })).toBe('guest')
  })
})
