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

  it('サインイン済みだが未課金は free（同期オフ・投稿は可）', () => {
    // アカウントを持てるのは有料会員だけ、という旧仕様を撤回した箇所。
    // platform に無料登録した人がここへ来ても閉じ込められない。
    expect(deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: false })).toBe('free')
  })

  it('サインイン済み かつ 課金は member（同期有効）', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: true })).toBe('member')
  })

  it('未サインインで課金クレームだけある異常系は guest（サインインを優先）', () => {
    expect(deriveStatus({ isLoaded: true, isSignedIn: false, hasPlan: true })).toBe('guest')
  })

  it('free と member は別状態（同期の可否を分ける）', () => {
    const free = deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: false })
    const member = deriveStatus({ isLoaded: true, isSignedIn: true, hasPlan: true })
    expect(free).not.toBe(member)
    // 同期・版管理のゲートは status === 'member' で判定しているため、
    // free が member に化けないことがそのままクラウド機能の保護になる。
    expect(free).not.toBe('member')
  })
})
