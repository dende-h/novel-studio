import { describe, expect, it } from 'vitest'
import { sampleTokens } from './fixtures'
import { frequentWordRanges, frequentWords } from './frequent-words'
import type { MorphToken } from './token'

describe('よく使う言葉（FR-9a）', () => {
  it('副詞と形容詞を原形で数え、多い順に件数と1万字あたりを返す', () => {
    const text = 'ふと、思わず、小さく笑った。ふと見ると、ゆっくり歩いていた。'
    const words = frequentWords([sampleTokens(text)], 10000, new Set())
    expect(words[0]).toEqual({ base: 'ふと', count: 2, per10k: 2 })
    expect(words.map((w) => w.base)).toEqual(
      expect.arrayContaining(['思わず', '小さい', 'ゆっくり']),
    )
  })
  it('1 文字の語・用語集の語は外し、上位だけを返す', () => {
    const text = 'ふと、思わず、小さく笑った。ふと見ると、ゆっくり歩いていた。'
    const words = frequentWords([sampleTokens(text)], 100, new Set(['ゆっくり']), 2)
    expect(words.map((w) => w.base)).toEqual(['ふと', expect.any(String)])
    expect(words.map((w) => w.base)).not.toContain('ゆっくり')
    expect(frequentWords([], 0, new Set())).toEqual([])
  })

  it('印の位置は、数えた語と同じ判定で段落ごとに返す（活用した形に付き、別の語の一部には付かない）', () => {
    const text = 'ふと、思わず、小さく笑った。ふと見ると、ゆっくり歩いていた。'
    expect(frequentWordRanges([sampleTokens(text)], '小さい')).toEqual([[{ start: 7, end: 10 }]])
    const tok = (surface: string, start: number, pos: string, base: string): MorphToken => ({
      surface,
      start,
      end: start + surface.length,
      pos,
      pos1: '一般',
      pos2: '*',
      ctype: '*',
      cform: '*',
      base,
      reading: '*',
    })
    const blocks = [[tok('ふとん', 0, '名詞', 'ふとん')], [tok('ふと', 0, '副詞', 'ふと')]]
    expect(frequentWordRanges(blocks, 'ふと')).toEqual([[], [{ start: 0, end: 2 }]])
  })
})
