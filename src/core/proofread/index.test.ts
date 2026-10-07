import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode } from '../schema'
import { countVariantsInBlocks, createVariantCountCache, proofreadNovel } from './index'
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
      [7, 'leader-odd'],
      [7, 'successive-word'],
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
        blockIndex: 0,
        code: 'variant',
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
