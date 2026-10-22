import { describe, expect, it } from 'vitest'
import { sampleTokens } from './fixtures'
import { frequentWordRanges, frequentWords } from './frequent-words'
import type { MorphToken } from './token'

const tok = (
  surface: string,
  start: number,
  pos: string,
  pos1 = '一般',
  base = surface,
): MorphToken => ({
  surface,
  start,
  end: start + surface.length,
  pos,
  pos1,
  pos2: '*',
  ctype: '*',
  cform: '*',
  base,
  reading: '*',
})

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
    const blocks = [[tok('ふとん', 0, '名詞')], [tok('ふと', 0, '副詞')]]
    expect(frequentWordRanges(blocks, 'ふと')).toEqual([[], [{ start: 0, end: 2 }]])
  })

  it('形容動詞の語幹（「静か」）も様子を表す言葉として数える。ふつうの名詞は数えない', () => {
    const tokens = [
      tok('静か', 0, '名詞', '形容動詞語幹'),
      tok('静か', 5, '名詞', '形容動詞語幹'),
      tok('海辺', 9, '名詞', '一般'),
    ]
    expect(frequentWords([tokens], 10000, new Set())).toEqual([
      { base: '静か', count: 2, per10k: 2 },
    ])
  })

  it('接続詞は種類を分けて数え、印も選んだ種類の箇所にだけ付ける（副詞の「また」と接続詞の「また」）', () => {
    const tokens = [
      tok('また', 0, '副詞'),
      tok('しかし', 3, '接続詞', '*'),
      tok('また', 8, '接続詞', '*'),
      tok('で', 11, '接続詞', '*'),
    ]
    expect(frequentWords([tokens], 10000, new Set(), 5, 'conjunction').map((w) => w.base)).toEqual([
      'しかし',
      'また',
    ])
    expect(frequentWords([tokens], 10000, new Set()).map((w) => w.base)).toEqual(['また'])
    expect(frequentWordRanges([tokens], 'また', 'conjunction')).toEqual([[{ start: 8, end: 10 }]])
    expect(frequentWordRanges([tokens], 'また')).toEqual([[{ start: 0, end: 2 }]])
  })
})
