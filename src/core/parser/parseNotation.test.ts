import { describe, expect, it } from 'vitest'
import type { Inline } from '../schema'
import { parseEpisodeBody, parseInlines } from './parseNotation'

describe('parseInlines', () => {
  it('プレーン行は1つのtext', () => {
    expect(parseInlines('こんにちは世界')).toEqual<Inline[]>([
      { type: 'text', text: 'こんにちは世界' },
    ])
  })

  it('明示ルビ（パイプ・非漢字親文字）', () => {
    expect(parseInlines('｜カオス《混沌》')).toEqual<Inline[]>([
      { type: 'ruby', base: 'カオス', reading: '混沌' },
    ])
  })

  it('半角パイプの明示ルビも許容', () => {
    expect(parseInlines('|Sky《スカイ》')).toEqual<Inline[]>([
      { type: 'ruby', base: 'Sky', reading: 'スカイ' },
    ])
  })

  it('自動ルビ（漢字親文字・パイプ省略）', () => {
    expect(parseInlines('漢字《かんじ》')).toEqual<Inline[]>([
      { type: 'ruby', base: '漢字', reading: 'かんじ' },
    ])
  })

  it('傍点（カクヨム式）', () => {
    expect(parseInlines('《《強調》》')).toEqual<Inline[]>([{ type: 'emphasisDots', text: '強調' }])
  })

  it('text + 自動ルビ + text の混在', () => {
    expect(parseInlines('私は漢字《かんじ》を書く')).toEqual<Inline[]>([
      { type: 'text', text: '私は' },
      { type: 'ruby', base: '漢字', reading: 'かんじ' },
      { type: 'text', text: 'を書く' },
    ])
  })

  it('閉じ括弧が無い不正記法は壊れずプレーンtext化', () => {
    expect(parseInlines('｜未完《よみ')).toEqual<Inline[]>([{ type: 'text', text: '｜未完《よみ' }])
  })
})

describe('parseEpisodeBody', () => {
  it('改行ごとに1 block・連番id', () => {
    const blocks = parseEpisodeBody('一行目\n二行目')
    expect(blocks).toEqual([
      { id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '一行目' }] },
      { id: 'b2', type: 'paragraph', inlines: [{ type: 'text', text: '二行目' }] },
    ])
  })

  it('空行は空paragraph（間として保持）', () => {
    const blocks = parseEpisodeBody('上\n\n下')
    expect(blocks).toEqual([
      { id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '上' }] },
      { id: 'b2', type: 'paragraph', inlines: [] },
      { id: 'b3', type: 'paragraph', inlines: [{ type: 'text', text: '下' }] },
    ])
  })

  it('＊のみの行はsceneBreak', () => {
    const blocks = parseEpisodeBody('前\n＊\n後')
    expect(blocks).toEqual([
      { id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '前' }] },
      { id: 'b2', type: 'sceneBreak' },
      { id: 'b3', type: 'paragraph', inlines: [{ type: 'text', text: '後' }] },
    ])
  })
})
