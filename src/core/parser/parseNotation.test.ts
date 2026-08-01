import { describe, expect, it } from 'vitest'
import type { Inline } from '../schema'
import { needsRubyPipe, parseEpisodeBody, parseInlines } from './parseNotation'

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

  it('GP9: ref の中のルビは解釈する（name は親文字＝解決に使うプレーン名）', () => {
    expect(parseInlines('[[剣《つるぎ》]]')).toEqual<Inline[]>([
      { type: 'ref', name: '剣', children: [{ type: 'ruby', base: '剣', reading: 'つるぎ' }] },
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

  // ── 記法の重ね（ref × ルビ／傍点）─────────────────────────────────
  // ボタンで [[]] と ｜《》 を別々に入れると自然に重なる。どちらの順で囲んでも
  // 「ref が外・装飾が中」の同じ形へ正規化する（プレビューの見た目とリンクを両立させる）。
  it('GP-N1: [[｜親文字《よみ》]] は ruby を children に持つ ref', () => {
    expect(parseInlines('[[｜言葉《ことば》]]')).toEqual<Inline[]>([
      { type: 'ref', name: '言葉', children: [{ type: 'ruby', base: '言葉', reading: 'ことば' }] },
    ])
    expect(parseInlines('[[|お嬢さん《おじょうさん》]]')).toEqual<Inline[]>([
      {
        type: 'ref',
        name: 'お嬢さん',
        children: [{ type: 'ruby', base: 'お嬢さん', reading: 'おじょうさん' }],
      },
    ])
  })

  it('GP-N2: [[《《傍点》》]] は emphasisDots を children に持つ ref', () => {
    expect(parseInlines('[[《《言葉》》]]')).toEqual<Inline[]>([
      { type: 'ref', name: '言葉', children: [{ type: 'emphasisDots', text: '言葉' }] },
    ])
  })

  it('GP-N3: 装飾で ref を囲んだ形も ref を外側へ持ち上げて同じ形にする', () => {
    expect(parseInlines('《《[[言葉]]》》')).toEqual(parseInlines('[[《《言葉》》]]'))
    expect(parseInlines('｜[[言葉]]《ことば》')).toEqual(parseInlines('[[｜言葉《ことば》]]'))
  })

  it('GP-N4: ref の中に text が混じる重ねも name はプレーン文字列になる', () => {
    expect(parseInlines('[[黒の剣《つるぎ》]]')).toEqual<Inline[]>([
      {
        type: 'ref',
        name: '黒の剣',
        children: [
          { type: 'text', text: '黒の' },
          { type: 'ruby', base: '剣', reading: 'つるぎ' },
        ],
      },
    ])
  })

  it('GP-N5: 部分的に囲っただけの傍点は持ち上げない（非解釈のまま）', () => {
    expect(parseInlines('《《前[[名前]]後》》')).toEqual<Inline[]>([
      { type: 'emphasisDots', text: '前[[名前]]後' },
    ])
  })

  it('GP-N6: ref の中に ref は作らない（重ねは 1 段）', () => {
    expect(parseInlines('[[外[[内]]')).toEqual<Inline[]>([{ type: 'ref', name: '外[[内' }])
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

  it('＊のみの行も通常の段落になる（sceneBreak は廃止）', () => {
    const blocks = parseEpisodeBody('前\n＊\n後')
    expect(blocks).toEqual([
      { id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '前' }] },
      { id: 'b2', type: 'paragraph', inlines: [{ type: 'text', text: '＊' }] },
      { id: 'b3', type: 'paragraph', inlines: [{ type: 'text', text: '後' }] },
    ])
  })
})

describe('needsRubyPipe（挿入 UI とパーサで判定を共有する）', () => {
  it('親文字が漢字だけならパイプ不要（自動ルビが効く）', () => {
    expect(needsRubyPipe('黄昏')).toBe(false)
    expect(needsRubyPipe('々')).toBe(false)
  })

  it('かな・英数字・記号が混じるならパイプが要る', () => {
    expect(needsRubyPipe('お嬢さん')).toBe(true)
    expect(needsRubyPipe('ひらがな')).toBe(true)
    expect(needsRubyPipe('Alice')).toBe(true)
    expect(needsRubyPipe('第1話')).toBe(true)
  })

  it('空文字はパイプありで組み立てる（親文字を後から打つため）', () => {
    expect(needsRubyPipe('')).toBe(true)
  })

  // 判定どおりに組み立てた記法が、実際にパーサでルビとして解釈されることまで見る
  // （ここがズレると「ボタンで入れたのにルビにならない」が起きる）。
  it('判定に従って組み立てた記法はパーサでルビになる', () => {
    const build = (base: string, reading: string) =>
      `${needsRubyPipe(base) ? '｜' : ''}${base}《${reading}》`

    expect(parseEpisodeBody(build('黄昏', 'たそがれ'))[0]?.inlines).toEqual([
      { type: 'ruby', base: '黄昏', reading: 'たそがれ' },
    ])
    expect(parseEpisodeBody(build('お嬢さん', 'おじょうさん'))[0]?.inlines).toEqual([
      { type: 'ruby', base: 'お嬢さん', reading: 'おじょうさん' },
    ])
  })
})
