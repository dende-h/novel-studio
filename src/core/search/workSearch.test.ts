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
    expect(planReplacement(sources, '猫', '猫猫', 'all').map((p) => p.count)).toEqual([4, 2])
    expect(planReplacement(sources, '猫', '', 'all')[1]?.after).toBe('')
    expect(planReplacement(sources, '猫', '猫', 'all')).toEqual([])
    expect(planReplacement(sources, '猫', 'a\nb', 'all')).toEqual([])
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
