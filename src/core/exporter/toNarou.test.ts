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

  it('GE-N1: @参照は名前のプレーンへ degrade する', () => {
    expect(blocksToNarou(parseEpisodeBody('[[アリス]]'))).toBe('アリス')
  })

  it('GE-MIX: ref+ルビ+text 混在行が欠落・重複なく連結される', () => {
    // 剣 は漢字のみ親文字なので自動ルビ（｜省略）で出る
    expect(blocksToNarou(parseEpisodeBody('私は[[アリス]]と剣《つるぎ》を'))).toBe(
      '私はアリスと剣《つるぎ》を',
    )
  })
})
