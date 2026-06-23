import { describe, expect, it } from 'vitest'
import { canonicalize } from './normalize'

describe('canonicalize（ハッシュ用の決定論シリアライズ）', () => {
  it('オブジェクトのキーをソートする', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('キー順が違っても同じ文字列になる（ハッシュ一致の要）', () => {
    expect(canonicalize({ a: 1, b: { d: 4, c: 3 } })).toBe(
      canonicalize({ b: { c: 3, d: 4 }, a: 1 }),
    )
  })

  it('配列の順序は保つ（本文ブロックの並びは意味を持つ）', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  it('ネストしたオブジェクト内のキーも再帰的にソートする', () => {
    expect(canonicalize([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]')
  })

  it('undefined のキーは出力しない', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}')
  })

  it('プリミティブと null をそのまま扱う', () => {
    expect(canonicalize('x')).toBe('"x"')
    expect(canonicalize(5)).toBe('5')
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
  })
})
