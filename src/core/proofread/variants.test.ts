import { describe, expect, it } from 'vitest'
import { countVariants, mergeCounts, VARIANT_GROUPS, variantNoticesForLine } from './variants'

const count = (gid: string, label: string, ...texts: string[]) =>
  countVariants(texts)[gid]?.[label]?.count ?? 0

describe('辞書の当たり／外れ', () => {
  it('出来る／できる：活用形で数え、音便（飛んできた・急いできた）と熟語は数えない', () => {
    expect(count('dekiru', 'できる', 'できた', '手でできた', '理解できる')).toBe(3)
    expect(count('dekiru', '出来る', '出来た', '出来なかった')).toBe(2)
    expect(count('dekiru', 'できる', '飛んできた', '急いできた', '泳いできた')).toBe(0)
    expect(count('dekiru', '出来る', '出来事', '上出来', '出来心')).toBe(0)
  })
  it('出来る／できる：い＋できる（お願いできる）は取りこぼしを許容する', () => {
    expect(count('dekiru', 'できる', 'お願いできますか', 'お会いできて')).toBe(0)
  })
  it('事／こと：直前の活用語尾と直後の助詞で縛り、熟語は数えない', () => {
    expect(count('koto', 'こと', '動くことが', 'いうことだ')).toBe(2)
    expect(count('koto', '事', '動く事が')).toBe(1)
    expect(count('koto', '事', '仕事が', '事件が', '返事が')).toBe(0)
  })
  it('時／とき：熟語は数えない', () => {
    expect(count('toki', 'とき', '帰るときに')).toBe(1)
    expect(count('toki', '時', '帰る時に')).toBe(1)
    expect(count('toki', '時', '当時は', '時間に', '一時は')).toBe(0)
  })
  it('良い／よい／いい：仲良く・良心は数えない', () => {
    expect(count('yoi', '良い', '良い天気', '良かった')).toBe(2)
    expect(count('yoi', 'いい', 'それがいい')).toBe(1)
    expect(count('yoi', 'よい', 'それはよい')).toBe(1)
    expect(count('yoi', '良い', '仲良く', '良心が', '改良した')).toBe(0)
  })
  it('彼ら／彼等：彼らしいは数えない', () => {
    expect(count('karera', '彼ら', '彼らは', '彼女らは')).toBe(2)
    expect(count('karera', '彼ら', '彼らしい', '彼女らしく')).toBe(0)
  })
  it('いたす／致す：直後で縛る（書いたし・泣いたせいで・聞いたすぐ後は数えない）', () => {
    expect(
      count('itasu', 'いたす', 'お願いいたします', '失礼いたしました', 'いたせば', 'そういたす。'),
    ).toBe(4)
    expect(count('itasu', '致す', '致します', '致せば', '致す')).toBe(3)
    expect(
      count(
        'itasu',
        'いたす',
        '書いたし',
        '聞いたして',
        '泣いたせいで',
        '書いたせいか',
        '聞いたすぐ後',
      ),
    ).toBe(0)
    expect(count('itasu', '致す', '一致した', '致命的')).toBe(0)
  })
  it('いたす／致す：いたしております・いたした は取りこぼしを許容する', () => {
    expect(count('itasu', 'いたす', 'お待ちいたしております', 'いたした')).toBe(0)
  })
  it('数の書き方：助数詞ごとに別の組。十分・三分の一・自分は数えない', () => {
    const c = countVariants([
      '2人、いや3人はいる',
      '一人の足音',
      '2026年',
      '十分に休んだ',
      '三分の一',
      '自分',
    ])
    expect(c['numeral:人']?.算用?.count).toBe(2)
    expect(c['numeral:人']?.漢数字?.count).toBe(1)
    expect(c['numeral:年']?.算用?.count).toBe(1)
    expect(c['numeral:年']?.漢数字).toBeUndefined()
    expect(c['numeral:分']).toBeUndefined()
  })
  it('全角数字も算用に数える', () => {
    expect(count('numeral:人', '算用', '２人')).toBe(1)
  })
  it('辞書のすべての正規表現が u フラグで構築できる', () => {
    for (const g of VARIANT_GROUPS) {
      for (const f of g.forms)
        expect(() => new RegExp(f.re, 'gu'), `${g.id}/${f.label}`).not.toThrow()
      if (g.exclude) expect(() => new RegExp(g.exclude as string, 'gu'), g.id).not.toThrow()
    }
  })
})

describe('mergeCounts', () => {
  it('件数は和、実例は左を優先し、入力を書き換えない', () => {
    const a = countVariants(['出来た'])
    const b = countVariants(['出来なかった', 'できた'])
    const m = mergeCounts(a, b)
    expect(m.dekiru?.出来る).toEqual({ count: 2, example: '出来た' })
    expect(m.dekiru?.できる).toEqual({ count: 1, example: 'できた' })
    expect(a.dekiru?.出来る?.count).toBe(1)
    expect(mergeCounts({}, {})).toEqual({})
  })
})

describe('variantNoticesForLine', () => {
  it('作品内で混在している組だけ、この行にある書き方を先頭にして 1 件', () => {
    const counts = countVariants(['出来た', 'できた', 'できる', 'できない'])
    expect(variantNoticesForLine('　その場を動くことが出来なかった。', counts)).toEqual([
      '「出来る」と「できる」が混ざっています（この作品で 出来る 1件・できる 3件）。どちらかに揃えると読みやすくなります。',
    ])
  })
  it('統一されている語は何も言わない', () => {
    const counts = countVariants(['できた', 'できる'])
    expect(variantNoticesForLine('　できることは何もない。', counts)).toEqual([])
  })
  it('この行に無い組は候補にしない', () => {
    const counts = countVariants(['出来た', 'できた'])
    expect(variantNoticesForLine('　夜の校舎に、私は立っていた。', counts)).toEqual([])
  })
  it('3 つの書き方は「・」でつなぐ', () => {
    const counts = countVariants(['それがいい', 'それはよい', '良い天気'])
    expect(variantNoticesForLine('　良い天気だ。', counts)[0]).toMatch(
      /^「良い」・「いい」・「よい」が混ざっています/,
    )
  })
  it('数の書き方は助数詞ごとに実例と件数を添え、1 行 1 件にまとめる', () => {
    const counts = countVariants(['一人の足音', '2人、いや3人', '三年前', '5年後'])
    expect(
      variantNoticesForLine('　一人の足音ではない。2人、いや3人はいる。5年後だ。', counts),
    ).toEqual([
      '数の書き方が算用数字と漢数字で混ざっています：人（2人・一人／算用 2件・漢数字 1件）・年（5年・三年／算用 1件・漢数字 1件）。',
    ])
  })
  it('助数詞が違う使い分け（2026年と一人）は混在にしない', () => {
    const counts = countVariants(['2026年の冬', '一人で歩いた'])
    expect(variantNoticesForLine('　2026年の冬、一人で歩いた。', counts)).toEqual([])
  })
  it('1 行に同じ組の語が複数回あっても 1 件', () => {
    const counts = countVariants(['出来た', 'できた'])
    expect(variantNoticesForLine('　出来た。出来なかった。できた。', counts)).toHaveLength(1)
  })
})
