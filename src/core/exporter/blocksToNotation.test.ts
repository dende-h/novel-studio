import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { blocksToNotation } from './blocksToNotation'
import { blocksToKakuyomu } from './toKakuyomu'

describe('blocksToNotation（ロスレス正本記法シリアライザ）', () => {
  it('GN1: @参照は [[名前]] で保存される（degrade しない）', () => {
    expect(blocksToNotation(parseEpisodeBody('私は[[アリス]]'))).toBe('私は[[アリス]]')
  })

  it('GN2: ref 非含有 blocks は blocksToKakuyomu と同一出力', () => {
    const src = [
      '私は漢字《かんじ》を書く',
      '',
      '｜カオス《混沌》が来る',
      '＊',
      '《《重要》》',
    ].join('\n')
    const blocks = parseEpisodeBody(src)
    expect(blocksToNotation(blocks)).toBe(blocksToKakuyomu(blocks))
  })

  it('GN3: parse→notation→parse が blocks レベルで恒等（ref 含む往復不動点）', () => {
    const src = ['私は[[アリス]]と｜カオス《混沌》を', '＊', '《《重要》》な[[場所]]'].join('\n')
    const once = parseEpisodeBody(src)
    const round = parseEpisodeBody(blocksToNotation(once))
    expect(round).toEqual(once)
  })

  it('GN3: notation 自体も往復で恒等（正本形テキスト不動点）', () => {
    // カオス は非漢字親文字なので明示｜が保たれる（剣 のような漢字は ｜省略が正本形）
    const src = ['私は[[アリス]]と｜カオス《混沌》を', '＊', '《《重要》》な[[場所]]'].join('\n')
    expect(blocksToNotation(parseEpisodeBody(src))).toBe(src)
  })
})
