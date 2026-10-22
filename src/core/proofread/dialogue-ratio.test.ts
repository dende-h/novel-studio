import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { addRatio, dialoguePercent, dialogueRatio } from './dialogue-ratio'
import { insideQuotes } from './quotes'

describe('insideQuotes', () => {
  it('括弧の記号と中を真にし、入れ子と閉じていない括弧を扱う', () => {
    const text = 'あ「い『う』え」お「か'
    expect(insideQuotes(text)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
    ])
    expect(insideQuotes('」あ')).toEqual([false, false])
  })
})

describe('セリフと地の文の割合（FR-9b）', () => {
  it('括弧の中をセリフ、外を地の文として、空白と記法の記号を除いて数える', () => {
    const blocks = parseEpisodeBody('　夜だった。\n「帰ろう」と｜宮森《みやもり》は言った。\n\n')
    expect(dialogueRatio(blocks)).toEqual({ dialogue: 5, narration: 13 })
  })
  it('サロゲートペアは 1 文字。割合は四捨五入、文字が無ければ 0', () => {
    expect(dialogueRatio(parseEpisodeBody('「𠮷」𠮷'))).toEqual({ dialogue: 3, narration: 1 })
    expect(dialoguePercent({ dialogue: 1, narration: 2 })).toBe(33)
    expect(dialoguePercent({ dialogue: 0, narration: 0 })).toBe(0)
    expect(addRatio({ dialogue: 1, narration: 2 }, { dialogue: 3, narration: 4 })).toEqual({
      dialogue: 4,
      narration: 6,
    })
  })
})
