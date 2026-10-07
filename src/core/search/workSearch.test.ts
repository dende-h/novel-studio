import { describe, expect, it } from 'vitest'
import { planReplacement, searchWork } from './workSearch'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}

const sources = [
  { episodeId: 'a', title: '一話', text: '猫😀猫\n[[猫]]｜猫《ねこ》' },
  { episodeId: 'b', title: '二話', text: '猫猫' },
]

describe('workSearch', () => {
  it('話順、UTF-16位置、行番号、記法と非重複を維持する', () => {
    const matches = searchWork(sources, '猫')
    expect(matches.map((m) => [m.episodeId, m.start, m.line])).toEqual([
      ['a', 0, 1],
      ['a', 3, 1],
      ['a', 7, 2],
      ['a', 11, 2],
      ['b', 0, 1],
      ['b', 1, 1],
    ])
    expect(searchWork([{ episodeId: 'a', title: '', text: 'aaa' }], 'aa')).toHaveLength(1)
    expect(searchWork(sources, '')).toEqual([])
    expect(searchWork(sources, '\n')).toEqual([])
    expect(searchWork(sources, ' CAT')).toEqual([])
  })
  it('空行を含めて行番号を数え、抜粋には一致した行だけを表示する', () => {
    const text = '前の猫\n\n該当の猫と猫\n後ろの猫'
    const matches = searchWork([{ episodeId: 'a', title: '', text }], '猫')
    expect(matches.map((m) => [m.line, m.excerpt])).toEqual([
      [1, '前の猫'],
      [3, '該当の猫と猫'],
      [3, '該当の猫と猫'],
      [4, '後ろの猫'],
    ])
    for (const match of matches) {
      expect(match.excerpt.slice(match.excerptMatchStart, match.excerptMatchEnd)).toBe('猫')
    }
  })
  it('1件だけを置換し、$文字を展開しない', () => {
    const match = required(searchWork(sources, '猫')[1])
    expect(planReplacement(sources, '猫', '$&$1', match)).toEqual([
      {
        episodeId: 'a',
        before: required(sources[0]).text,
        after: '猫😀$&$1\n[[猫]]｜猫《ねこ》',
        count: 1,
      },
    ])
  })
  it('検索語を含む置換語を繰り返し置換せず、空置換を扱う', () => {
    expect(planReplacement(sources, '猫', '猫猫', 'all').map((p) => p.count)).toEqual([3, 2])
    expect(planReplacement(sources, '猫', '', 'all')[1]?.after).toBe('')
    expect(planReplacement(sources, '猫', '猫', 'all')).toEqual([])
    expect(planReplacement(sources, '猫', 'a\nb', 'all')).toEqual([])
  })
  it('参照は検索・移動用に残し、単独指定でも全置換でも書き換えない', () => {
    const matches = searchWork(sources, '猫')
    expect(matches.map((m) => m.isReference)).toEqual([false, false, true, false, false, false])
    expect(planReplacement(sources, '猫', '犬', required(matches[2]))).toEqual([])
    expect(planReplacement(sources, '猫', '犬', 'all')[0]?.after).toBe('犬😀犬\n[[猫]]｜犬《ねこ》')
  })
  it.each([
    '[',
    ']',
    '[[猫]]',
    '前[[',
    ']]後',
    '猫]]後',
  ])('参照の括弧や境界に重なる %s を保護する', (query) => {
    const text = '前[[猫]]後'
    const input = [{ episodeId: 'a', title: '', text }]
    expect(searchWork(input, query).every((m) => m.isReference)).toBe(true)
    expect(planReplacement(input, query, '', 'all')).toEqual([])
  })
  it('装飾・別名・未解決・未終端の参照を保護し、次の行の通常本文は置換する', () => {
    const input = [
      {
        episodeId: 'a',
        title: '',
        text: '猫 [[｜猫《ねこ》]] 《《[[猫]]》》 ｜[[猫]]《ねこ》 [[別名の猫]] [[未登録の猫]]\n[[猫の途中\n猫',
      },
    ]
    expect(searchWork(input, '猫').filter((m) => m.isReference)).toHaveLength(6)
    const plan = required(planReplacement(input, '猫', '', 'all')[0])
    expect(plan.count).toBe(2)
    expect(plan.after).toBe(
      ' [[｜猫《ねこ》]] 《《[[猫]]》》 ｜[[猫]]《ねこ》 [[別名の猫]] [[未登録の猫]]\n[[猫の途中\n',
    )
  })
  it('古い位置は拒否し、抜粋の絵文字を分割しない', () => {
    const match = required(searchWork(sources, '猫')[0])
    expect(() => planReplacement(sources, '猫', '犬', { ...match, start: 1 })).toThrow(
      '検索し直して',
    )
    const text = `${'😀'.repeat(40)}猫${'😀'.repeat(40)}`
    const excerpt = required(searchWork([{ episodeId: 'a', title: '', text }], '猫')[0])
    expect(excerpt.excerpt.slice(excerpt.excerptMatchStart, excerpt.excerptMatchEnd)).toBe('猫')
    expect(excerpt.excerpt).not.toMatch(/…[\uDC00-\uDFFF]|[\uD800-\uDBFF]…/)
  })
})
