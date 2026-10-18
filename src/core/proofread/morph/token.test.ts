import { describe, expect, it } from 'vitest'
import { sampleTokens } from './fixtures'
import { isUnknownToken, toMorphTokens } from './token'

describe('toMorphTokens', () => {
  it('表層形を前から探して位置を付ける（全角空白・記号を含む）', () => {
    const text = '「ここからでも見れるよ」と彼は言った。'
    const tokens = sampleTokens(text)
    for (const t of tokens) expect(text.slice(t.start, t.end)).toBe(t.surface)
    expect(tokens.map((t) => t.surface).join('')).toBe(text)
    expect(tokens.find((t) => t.surface === '見れる')).toMatchObject({
      pos: '動詞',
      pos1: '自立',
      ctype: '一段',
      base: '見れる',
    })
  })
  it('解析器が文字を落としても位置はずれず、欠けた欄は * とみなす', () => {
    const text = '𠮷野 は来た'
    const tokens = toMorphTokens(
      [
        ['𠮷野', '名詞'],
        ['は', '助詞', '係助詞'],
        ['来', '動詞'],
      ],
      text,
    )
    expect(tokens.map((t) => [t.surface, t.start, t.end])).toEqual([
      ['𠮷野', 0, 3],
      ['は', 4, 5],
      ['来', 5, 6],
    ])
    expect(tokens[0]).toMatchObject({ pos1: '*', base: '*', reading: '*' })
  })

  it('細分類2（pos2）を写す', () => {
    const tokens = sampleTokens('宮森は言った。')
    expect(tokens[0]).toMatchObject({ surface: '宮森', pos1: '固有名詞', pos2: '人名' })
  })
})

describe('isUnknownToken', () => {
  it('原形が * の語を辞書に無い語とみなす', () => {
    const tokens = toMorphTokens(
      [
        ['アルヴェイン', '名詞', '一般', '*', '*', '*', '*', '*'],
        ['宮森', '名詞', '固有名詞', '人名', '姓', '*', '*', '宮森', 'ミヤモリ', 'ミヤモリ'],
      ],
      'アルヴェイン宮森',
    )
    expect(tokens.map(isUnknownToken)).toEqual([true, false])
  })
})
