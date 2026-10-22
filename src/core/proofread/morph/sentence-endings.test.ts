import { describe, expect, it } from 'vitest'
import { sampleTokens } from './fixtures'
import { sentenceEndings } from './sentence-endings'
import type { MorphToken } from './token'

const tok = (
  surface: string,
  start: number,
  pos: string,
  pos1 = '一般',
  base = surface,
): MorphToken => ({
  surface,
  start,
  end: start + surface.length,
  pos,
  pos1,
  pos2: '*',
  ctype: '*',
  cform: '*',
  base,
  reading: '*',
})

/** 例文（実際の解析結果のフィクスチャ）を段落として並べる。 */
const ofSamples = (texts: string[]) =>
  sentenceEndings(
    texts,
    texts.map((t) => sampleTokens(t)),
  )

describe('文末の偏り（地の文）', () => {
  it('文を終わり方で分ける：「〜た」「〜る・〜い・〜だ」・そのほか', () => {
    const r = ofSamples([
      '材料不足で代替素材で製品を作った。',
      '私は彼は好きだ。',
      '非常口の緑の光がが揺れて',
    ])
    expect(r.endings.map((e) => e.kind)).toEqual(['ta', 'present', 'other'])
    expect(r.counts).toEqual({ ta: 1, present: 1, noun: 0, other: 1 })
    // 印は文末の語に付ける
    expect(r.endings[0]).toMatchObject({ block: 0, start: 15, end: 16 })
  })

  it('名詞で終わる文は体言止め', () => {
    const text = '静かな夜。'
    const tokens = [
      tok('静か', 0, '名詞', '形容動詞語幹'),
      tok('な', 2, '助動詞', '*', 'だ'),
      tok('夜', 3, '名詞'),
      tok('。', 4, '記号', '句点'),
    ]
    expect(sentenceEndings([text], [tokens]).endings).toEqual([
      { block: 0, kind: 'noun', start: 3, end: 4 },
    ])
  })

  it('括弧の中の「。」では区切らず、セリフの中の語は数えない', () => {
    const r = ofSamples(['「ここからでも見れるよ」と彼は言った。'])
    expect(r.endings.map((e) => e.kind)).toEqual(['ta'])
  })

  it('同じ文末が4文以上続いたところを返す（段落はまたぐ）', () => {
    const r = ofSamples(['食べれる。起きれる。寝れない。来れない。見れる。'])
    expect(r.runs).toHaveLength(1)
    expect(r.runs[0]?.map((e) => e.kind)).toEqual(Array(5).fill('present'))
    const across = ofSamples([
      '材料不足で代替素材で製品を作った。',
      '私も彼も笑った。',
      '何かが動いた気がした。',
      '宮森は言った。',
    ])
    expect(across.runs.map((run) => run.map((e) => e.block))).toEqual([[0, 1, 2, 3]])
  })

  it('セリフだけの段落を挟むと続きを切る。3文までは続きに数えない', () => {
    const texts = [
      '材料不足で代替素材で製品を作った。',
      '私も彼も笑った。',
      '「待って」',
      '何かが動いた気がした。',
      '宮森は言った。',
    ]
    const tokens = texts.map((t) => (t.startsWith('「') ? [] : sampleTokens(t)))
    const r = sentenceEndings(texts, tokens)
    expect(r.counts.ta).toBe(4)
    expect(r.runs).toEqual([])
  })

  it('空の段落と本文の無い話は数えない', () => {
    expect(sentenceEndings(['', '　'], [[], []])).toEqual({
      endings: [],
      counts: { ta: 0, present: 0, noun: 0, other: 0 },
      runs: [],
    })
  })
})
