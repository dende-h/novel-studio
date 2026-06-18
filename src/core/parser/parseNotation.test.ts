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

  // ── @参照 [[名前]]（P1） ──────────────────────────────────────────
  it('GP1: [[名前]] → ref', () => {
    expect(parseInlines('[[アリス]]')).toEqual<Inline[]>([{ type: 'ref', name: 'アリス' }])
  })

  it('GP2: text に挟まれた ref', () => {
    expect(parseInlines('私は[[アリス]]に会った')).toEqual<Inline[]>([
      { type: 'text', text: '私は' },
      { type: 'ref', name: 'アリス' },
      { type: 'text', text: 'に会った' },
    ])
  })

  it('GP3: 前後空白は trim（半角/全角）', () => {
    expect(parseInlines('[[ アリス ]]')).toEqual<Inline[]>([{ type: 'ref', name: 'アリス' }])
    expect(parseInlines('[[　アリス　]]')).toEqual<Inline[]>([{ type: 'ref', name: 'アリス' }])
  })

  it('GP4: 未終端 [[ は行末を終端に ref 化（フォールバックでなく）', () => {
    expect(parseInlines('行末 [[未完')).toEqual<Inline[]>([
      { type: 'text', text: '行末 ' },
      { type: 'ref', name: '未完' },
    ])
  })

  it('GP-EMPTY: 空 [[]] / [[　]] も常に ref（name=空）', () => {
    expect(parseInlines('[[]]')).toEqual<Inline[]>([{ type: 'ref', name: '' }])
    expect(parseInlines('[[　]]')).toEqual<Inline[]>([{ type: 'ref', name: '' }])
  })

  it('GP9: name 内の《》は非解釈で ]] まで literal', () => {
    expect(parseInlines('[[剣《つるぎ》]]')).toEqual<Inline[]>([
      { type: 'ref', name: '剣《つるぎ》' },
    ])
  })

  it('GP10: 連続 ref は空 text を挟まず分割', () => {
    expect(parseInlines('[[A]][[B]]')).toEqual<Inline[]>([
      { type: 'ref', name: 'A' },
      { type: 'ref', name: 'B' },
    ])
  })

  it('GP11: ref 前後の text flush 境界', () => {
    expect(parseInlines('x[[A]]y[[B]]z')).toEqual<Inline[]>([
      { type: 'text', text: 'x' },
      { type: 'ref', name: 'A' },
      { type: 'text', text: 'y' },
      { type: 'ref', name: 'B' },
      { type: 'text', text: 'z' },
    ])
  })

  it('GP12: ref 直後の句読点は text', () => {
    expect(parseInlines('[[アリス]]、おはよう')).toEqual<Inline[]>([
      { type: 'ref', name: 'アリス' },
      { type: 'text', text: '、おはよう' },
    ])
  })

  it('GP13: ref / ruby / text 混在の境界', () => {
    expect(parseInlines('私は[[アリス]]と｜剣《つるぎ》を')).toEqual<Inline[]>([
      { type: 'text', text: '私は' },
      { type: 'ref', name: 'アリス' },
      { type: 'text', text: 'と' },
      { type: 'ruby', base: '剣', reading: 'つるぎ' },
      { type: 'text', text: 'を' },
    ])
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
