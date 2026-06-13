import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { blocksToKakuyomu } from './toKakuyomu'

describe('blocksToKakuyomu', () => {
  it('プレーン/自動ルビ/明示ルビ/空行/区切りが往復で恒等', () => {
    const src = ['私は漢字《かんじ》を書く', '', '｜カオス《混沌》が来る', '＊', '終わり'].join('\n')
    expect(blocksToKakuyomu(parseEpisodeBody(src))).toBe(src)
  })

  it('傍点はカクヨム式 《《》》 で恒等（なろうと違い degrade しない）', () => {
    expect(blocksToKakuyomu(parseEpisodeBody('《《重要》》'))).toBe('《《重要》》')
  })

  it('傍点・ルビ・区切りを含む全体の往復が恒等', () => {
    const src = ['彼は《《絶対》》に来る', '＊', '星《ほし》'].join('\n')
    expect(blocksToKakuyomu(parseEpisodeBody(src))).toBe(src)
  })

  it('漢字のみ親文字ルビは自動ルビ（｜省略）で出力', () => {
    expect(blocksToKakuyomu([{ id: 'b1', type: 'paragraph', inlines: [{ type: 'ruby', base: '漢字', reading: 'かんじ' }] }])).toBe('漢字《かんじ》')
  })

  it('非漢字親文字ルビは明示｜で出力', () => {
    expect(blocksToKakuyomu([{ id: 'b1', type: 'paragraph', inlines: [{ type: 'ruby', base: 'カオス', reading: '混沌' }] }])).toBe('｜カオス《混沌》')
  })
})
