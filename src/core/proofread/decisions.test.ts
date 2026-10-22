import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { reconcileBlockIds } from '../parser/reconcileBlockIds'
import type { Block } from '../schema'
import {
  classify,
  decide,
  findingKey,
  locateFix,
  occurrencesOf,
  openFixes,
  type ProofreadRecord,
  ProofreadRecordSchema,
  undecide,
  withNth,
} from './decisions'
import { proofreadNovel } from './index'
import { countAutoVariants } from './morph/auto-variant'
import { sampleTokens } from './morph/fixtures'
import type { Finding } from './types'

const ids = { workId: 'w', episodeId: 'e' }
const NOW = 1_000

/** 保存済みの blocks を下書きの編集に合わせて読み直す（editorStore.save と同じ reconcile）。 */
const edit = (blocks: Block[], draft: string) => reconcileBlockIds(blocks, parseEpisodeBody(draft))
const findingsOf = (blocks: Block[]) => withNth(proofreadNovel(blocks))

describe('occurrencesOf', () => {
  it('1 文字ずつずらして探し、重なり合う出現もそれぞれ数える', () => {
    expect(occurrencesOf('ご…ご', 'ご…ご…ごめん')).toEqual([0, 2])
    expect(occurrencesOf('aa', 'aaa')).toEqual([0, 1])
    expect(occurrencesOf('', 'abc')).toEqual([])
  })
})

describe('withNth と照合', () => {
  it('同じ段落・同じ項目・同じ文字列の指摘に位置の順で番号を振る', () => {
    const f = findingsOf(parseEpisodeBody('「行こう。」「うん。」'))
    expect(f.map((x) => [x.code, x.text, x.nth])).toEqual([
      ['punct-before-close', '。」', 0],
      ['punct-before-close', '。」', 1],
    ])
  })
  it('判断を当てて未判断・直す・このままに分ける。同じ段落の 2 件目は別扱い', () => {
    const blocks = parseEpisodeBody('「行こう。」「うん。」')
    const [a, b] = findingsOf(blocks)
    const rec = decide(undefined, ids, [a as never], 'keep', NOW, blocks)
    const c = classify(findingsOf(blocks), rec)
    expect(c.keep.map((x) => x.nth)).toEqual([0])
    expect(c.pending.map((x) => x.nth)).toEqual([1])
    expect(findingKey(b as never)).not.toBe(findingKey(a as never))
  })
  it('別の段落を編集・挿入・削除しても、判断はその指摘に付いたまま', () => {
    const blocks = parseEpisodeBody('彼は言った。\n「待って。」')
    const target = findingsOf(blocks).find((f) => f.code === 'punct-before-close')
    const rec = decide(undefined, ids, [target as never], 'fix', NOW, blocks)
    const after = edit(blocks, '　新しい段落。\n　彼は言った。\n「待って。」')
    expect(classify(findingsOf(after), rec).fix.map((f) => f.text)).toEqual(['。」'])
  })
})

describe('decide / undecide', () => {
  it('occurrence は start より前で始まる同じ文字列の数（指摘でない出現も数える）', () => {
    const blocks = parseEpisodeBody('仕事の事を考えた。')
    const f: Finding = {
      blockId: blocks[0]?.id as string,
      blockIndex: 0,
      code: 'variant',
      start: 3,
      end: 4,
      text: '事',
      anchor: 'contains',
      message: 'm',
    }
    const rec = decide(undefined, ids, withNth([f]), 'fix', NOW, blocks)
    expect(rec.decisions[0]).toMatchObject({ text: '事', nth: 0, occurrence: 1, verdict: 'fix' })
  })
  it('同じキーは置き換え、ほかの判断には触らず、入力を書き換えない', () => {
    const blocks = parseEpisodeBody('「行こう。」「うん。」')
    const [a, b] = findingsOf(blocks)
    const r1 = decide(undefined, ids, [a as never], 'keep', NOW, blocks)
    const r2 = decide(r1, ids, [b as never], 'fix', NOW + 1, blocks)
    const r3 = decide(r2, ids, [a as never], 'fix', NOW + 2, blocks)
    expect(r1.decisions).toHaveLength(1)
    expect(r3.decisions.map((d) => [d.nth, d.verdict])).toEqual([
      [1, 'fix'],
      [0, 'fix'],
    ])
    expect(r3.updatedAt).toBe(NOW + 2)
    const r4 = undecide(r3, a as never, NOW + 3)
    expect(r4.decisions.map((d) => d.nth)).toEqual([1])
    expect(undecide(r4, r4.decisions[0] as never, NOW + 4).decisions).toEqual([])
  })
  it('未知の code・verdict・anchor を落とさずに読み、未知の verdict は未判断として扱う', () => {
    const raw = {
      workId: 'w',
      episodeId: 'e',
      updatedAt: 1,
      decisions: [
        {
          blockId: 'b1',
          code: 'future-rule',
          text: 'x',
          verdict: 'maybe',
          anchor: 'somewhere',
          decidedAt: 1,
        },
      ],
    }
    const rec = ProofreadRecordSchema.parse(raw)
    expect(rec.decisions[0]).toMatchObject({
      code: 'future-rule',
      verdict: 'maybe',
      anchor: 'somewhere',
      nth: 0,
    })
    const blocks = parseEpisodeBody('x')
    expect(openFixes(rec, blocks)).toEqual([])
    expect(
      ProofreadRecordSchema.parse({ workId: 'w', episodeId: 'e', updatedAt: 1 }).decisions,
    ).toEqual([])
  })
})

describe('openFixes（直す箇所）', () => {
  const fixAll = (
    blocks: Block[],
    pick: (f: Finding & { nth: number }) => boolean,
  ): ProofreadRecord => decide(undefined, ids, findingsOf(blocks).filter(pick), 'fix', NOW, blocks)

  it('判断した文字列が段落から消えたら直ったとみなす。段落ごと消しても同じ', () => {
    const blocks = parseEpisodeBody('「待って。」\n　光がが揺れた。')
    const rec = fixAll(blocks, () => true)
    expect(openFixes(rec, blocks).map((f) => f.decision.text)).toEqual(['。」', 'がが'])
    expect(openFixes(rec, edit(blocks, '「待って」\n　光がが揺れた。'))).toHaveLength(1)
    expect(openFixes(rec, edit(blocks, '「待って。」'))).toHaveLength(1)
  })
  it('字下げは段落の頭がまだその文字で始まるかを見る', () => {
    const blocks = parseEpisodeBody('彼は言った。')
    const rec = fixAll(blocks, (f) => f.code === 'indent')
    expect(openFixes(rec, blocks)).toHaveLength(1)
    expect(openFixes(rec, edit(blocks, '　彼は言った。'))).toEqual([])
  })
  it('1つ目このまま・2つ目直す：2つ目を直すと 0 件、残った 1 つ目はこのまま', () => {
    const blocks = parseEpisodeBody('「行こう。」「うん。」')
    const [a, b] = findingsOf(blocks)
    const rec = decide(
      decide(undefined, ids, [a as never], 'keep', NOW, blocks),
      ids,
      [b as never],
      'fix',
      NOW,
      blocks,
    )
    expect(openFixes(rec, blocks).map((f) => f.start)).toEqual([9])
    const after = edit(blocks, '「行こう。」「うん」')
    expect(openFixes(rec, after)).toEqual([])
    const c = classify(findingsOf(after), rec)
    expect([c.fix.length, c.keep.length]).toEqual([0, 1])
  })
  it('両方直す：1つ目だけ直すと 2 件から 1 件', () => {
    const blocks = parseEpisodeBody('「行こう。」「うん。」')
    const rec = fixAll(blocks, () => true)
    expect(openFixes(rec, blocks)).toHaveLength(2)
    expect(openFixes(rec, edit(blocks, '「行こう」「うん。」'))).toHaveLength(1)
  })
  it('重なり合う指摘（ご…ご…ごめん）の 2 つ目だけ直す', () => {
    const blocks = parseEpisodeBody('ご…ご…ごめん')
    const rec = fixAll(blocks, (f) => f.code === 'leader-odd' && f.nth === 1)
    expect(openFixes(rec, blocks).map((f) => [f.start, f.end])).toEqual([[2, 5]])
    expect(openFixes(rec, edit(blocks, 'ご…ご……ごめん'))).toEqual([])
  })
  it('指摘にならない同じ文字列が前にあっても、指摘の出現を指す（飛んできた／できた）', () => {
    const text = '鳥が飛んできた。彼にもできた。出来なかった。'
    const blocks = parseEpisodeBody(text)
    const rec = fixAll(blocks, (f) => f.code === 'variant' && f.text === 'できた')
    expect(rec.decisions[0]).toMatchObject({ text: 'できた', occurrence: 1 })
    expect(openFixes(rec, blocks).map((f) => f.start)).toEqual([text.lastIndexOf('できた')])
    expect(openFixes(rec, edit(blocks, '鳥が飛んできた。彼にも出来た。出来なかった。'))).toEqual([])
  })
  it('括弧の中の「見れ」と地の文の「見れ」（ら抜き）', () => {
    const text = '「ここから見れるよ」と言ったが、私には見れなかった。'
    const blocks = parseEpisodeBody(text)
    const morph = {
      tokens: [sampleTokens(text)],
      workVariants: countAutoVariants([], new Set()),
      excluded: new Set<string>(),
    }
    const f = withNth(proofreadNovel(blocks, { morph })).filter((x) => x.code === 'ra-nuki')
    const rec = decide(undefined, ids, f, 'fix', NOW, blocks)
    expect(rec.decisions[0]).toMatchObject({ text: '見れ', occurrence: 1 })
    expect(openFixes(rec, blocks).map((x) => x.start)).toEqual([text.lastIndexOf('見れ')])
    expect(
      openFixes(rec, edit(blocks, '「ここから見れるよ」と言ったが、私には見られなかった。')),
    ).toEqual([])
  })
  it('occurrence の無い記録は nth で代用する', () => {
    const blocks = parseEpisodeBody('「行こう。」「うん。」')
    const rec: ProofreadRecord = {
      ...ids,
      updatedAt: 1,
      decisions: [
        {
          blockId: blocks[0]?.id as string,
          code: 'punct-before-close',
          text: '。」',
          nth: 1,
          anchor: 'contains',
          verdict: 'fix',
          decidedAt: 1,
        },
      ],
    }
    expect(openFixes(rec, blocks).map((f) => f.start)).toEqual([9])
  })
})

describe('locateFix', () => {
  it('段落の行の位置へ移す（前の行の長さと改行を足す）', () => {
    const draft = '一行目\n「待って。」'
    expect(locateFix({ blockIndex: 1, start: 3, end: 5 }, draft)).toEqual({
      start: 7,
      end: 9,
      whole: false,
    })
  })
  it('ルビの読みの中は選ばず、本文の出現を選ぶ', () => {
    const draft = '｜言葉《ことば》と、ことば'
    const blocks = parseEpisodeBody(draft)
    const rec = decide(
      undefined,
      ids,
      withNth([
        {
          blockId: blocks[0]?.id as string,
          blockIndex: 0,
          code: 'variant',
          start: 4,
          end: 7,
          text: 'ことば',
          anchor: 'contains',
          message: '',
        },
      ]),
      'fix',
      NOW,
      blocks,
    )
    const [fix] = openFixes(rec, blocks)
    expect(locateFix(fix as never, draft)).toEqual({ start: 10, end: 13, whole: false })
  })
  it('ルビの親文字は 1 文字ずつ対応し、自動ルビ・傍点も同じ', () => {
    expect(locateFix({ blockIndex: 0, start: 0, end: 2 }, '｜言葉《ことば》だ')).toMatchObject({
      start: 1,
      end: 3,
    })
    expect(locateFix({ blockIndex: 0, start: 0, end: 2 }, '漢字《かんじ》だ')).toMatchObject({
      start: 0,
      end: 2,
    })
    expect(locateFix({ blockIndex: 0, start: 1, end: 3 }, 'あ《《強調》》い')).toMatchObject({
      start: 3,
      end: 5,
    })
  })
  it('参照の中にかかると行全体を返す（ほかの行は探さない）', () => {
    const draft = 'x\n[[宮森]]…と言った'
    expect(locateFix({ blockIndex: 1, start: 1, end: 4 }, draft)).toEqual({
      start: 2,
      end: draft.length,
      whole: true,
    })
  })
})
