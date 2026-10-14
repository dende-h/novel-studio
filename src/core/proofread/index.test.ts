import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode } from '../schema'
import {
  countAutoVariants,
  countVariantsInBlocks,
  createVariantCountCache,
  proofreadNovel,
} from './index'
import { sampleTokens } from './morph/fixtures'
import * as variants from './variants'

// vitest はリポジトリルートを cwd にして走る（vite.config.ts）
const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'tools/novel-textlint/fixtures', name), 'utf8')

describe('proofreadNovel', () => {
  it('novel-good.txt（ルビ・傍点・＊・！　）は候補 0 件', () => {
    expect(proofreadNovel(parseEpisodeBody(fixture('novel-good.txt')))).toEqual([])
  })
  it('novel-bad.txt は期待どおりの行と項目を返し、AI 常套句の行は出ない', () => {
    const notices = proofreadNovel(parseEpisodeBody(fixture('novel-bad.txt')))
    expect(notices.map((n) => [n.blockIndex + 1, n.code])).toEqual([
      [2, 'punct-before-close'],
      [3, 'indent'],
      [4, 'halfwidth-punct'],
      [7, 'successive-word'],
      [7, 'leader-odd'],
    ])
  })
  it('記法（ルビ・傍点・参照）の記号は候補の原因にならない（解いたプレーン文字列を検査する）', () => {
    expect(
      proofreadNovel(
        parseEpisodeBody(
          '　[[宮森]]は言った。\n　《《だれか》》いる。\n　｜宮森《みやもり》は[[｜言葉《ことば》]]を',
        ),
      ),
    ).toEqual([])
    // 記法を解いた後の行頭が本文の文字なら、字下げの候補にはなる
    expect(proofreadNovel(parseEpisodeBody('[[宮森]]は言った。')).map((n) => n.code)).toEqual([
      'indent',
    ])
  })
  it('空の本文では候補を出さず、入力の blocks を書き換えない', () => {
    expect(proofreadNovel([])).toEqual([])
    const blocks = parseEpisodeBody('「もう帰ろうよ。」\n\n　')
    const before = structuredClone(blocks)
    expect(proofreadNovel(blocks)).toHaveLength(1)
    expect(blocks).toEqual(before)
  })
  it('disabled の項目は候補を作らず、variant なら集計もしない', () => {
    const spy = vi.spyOn(variants, 'countVariants')
    const blocks = parseEpisodeBody('彼は「待って!」と言った。出来た。できた。')
    expect(proofreadNovel(blocks).map((n) => n.code)).toEqual([
      'indent',
      'halfwidth-punct',
      'variant',
      'variant',
    ])
    expect(
      proofreadNovel(blocks, { disabled: new Set(['indent', 'variant']) }).map((n) => n.code),
    ).toEqual(['halfwidth-punct'])
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('baseCounts（他の話）と合算して混在を判定する', () => {
    const blocks = parseEpisodeBody('　できることは、もう何もなかった。')
    expect(proofreadNovel(blocks)).toEqual([])
    const base = countVariantsInBlocks(parseEpisodeBody('　出来た。'))
    expect(proofreadNovel(blocks, { baseCounts: base })).toEqual([
      {
        blockId: blocks[0]?.id,
        blockIndex: 0,
        code: 'variant',
        start: 1,
        end: 4,
        text: 'できる',
        anchor: 'contains',
        message:
          '「できる」と「出来る」が混ざっています（この作品で できる 1件・出来る 1件）。どちらかに揃えると読みやすくなります。',
      },
    ])
  })
})

describe('createVariantCountCache', () => {
  const ep = (id: string, text: string): Episode => ({
    id,
    title: id,
    blocks: parseEpisodeBody(text),
  })

  it('同じ Episode 参照には再計算せず、別参照になった話だけ数え直す', () => {
    const spy = vi.spyOn(variants, 'countVariants')
    const cache = createVariantCountCache()
    const a = ep('a', '　出来た。')
    const b = ep('b', '　できた。')
    expect(cache([a, b]).dekiru).toEqual({
      出来る: { count: 1, example: '出来た' },
      できる: { count: 1, example: 'できた' },
    })
    expect(spy).toHaveBeenCalledTimes(2)
    // 自動保存は episodes 配列を作り直すが、編集していない話は同じ参照のまま
    cache([a, b])
    expect(spy).toHaveBeenCalledTimes(2)
    const b2 = { ...b, blocks: parseEpisodeBody('　できた。できる。') }
    expect(cache([a, b2]).dekiru?.できる?.count).toBe(2)
    expect(spy).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })
  it('空の配列は空の集計', () => {
    expect(createVariantCountCache()([])).toEqual({})
  })
})

describe('くわしい確認（morph）との合流', () => {
  const morphOf = (texts: string[]) => {
    const tokens = texts.map((t) => sampleTokens(t))
    return {
      tokens,
      workVariants: countAutoVariants(tokens, new Set()),
      excluded: new Set<string>(),
    }
  }

  it('辞書の表記ゆれは、解析器の有無で文字列も範囲も変わらない。重なる自動の指摘は出さない', () => {
    const text = '鳥が飛んできた。彼にもできた。出来なかった。'
    const blocks = parseEpisodeBody(text)
    const dict = proofreadNovel(blocks).filter((f) => f.code === 'variant')
    const withMorph = proofreadNovel(blocks, { morph: morphOf([text]) }).filter(
      (f) => f.code === 'variant',
    )
    for (const d of dict) expect(withMorph).toContainEqual(d)
    for (const m of withMorph) {
      const overlapsDict = dict.some((d) => d.start < m.end && m.start < d.end)
      if (overlapsDict) expect(dict).toContainEqual(m)
    }
  })
  it('自動の表記ゆれ・同じ助詞・ら抜きを出し、項目をオフにすると出さない', () => {
    const texts = [
      '子供と子どもが遊ぶ。',
      '私は彼は好きだ。',
      '食べれる。起きれる。寝れない。来れない。見れる。',
    ]
    const blocks = parseEpisodeBody(texts.join('\n'))
    const morph = morphOf(texts)
    const codes = proofreadNovel(blocks, { morph }).map((f) => f.code)
    expect(codes).toEqual(expect.arrayContaining(['variant', 'doubled-particle', 'ra-nuki']))
    const off = proofreadNovel(blocks, {
      morph,
      disabled: new Set(['variant', 'doubled-particle', 'ra-nuki', 'indent']),
    })
    expect(off).toEqual([])
  })
  it('解析器が無ければ品詞を使う指摘は出さない', () => {
    const blocks = parseEpisodeBody('　私は彼は好きだ。')
    expect(proofreadNovel(blocks)).toEqual([])
  })
})
