import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { blocksToNarou } from './toNarou'

describe('blocksToNarou', () => {
  it('プレーン・自動ルビ・明示ルビ・空行・シーン区切りが往復で恒等', () => {
    const src = ['私は漢字《かんじ》を書く', '', '｜カオス《混沌》が来る', '＊', '終わり'].join(
      '\n',
    )
    expect(blocksToNarou(parseEpisodeBody(src))).toBe(src)
  })

  it('傍点はなろうに記法が無いのでルビ・へ degrade する', () => {
    const blocks = parseEpisodeBody('《《重要》》')
    expect(blocksToNarou(blocks)).toBe('｜重《・》｜要《・》')
  })
})
