import { plainTextOfBlock } from '../game'
import type { Block } from '../schema'
import { insideQuotes } from './quotes'

/** セリフ（括弧の中）と地の文の文字数（COT-40）。 */
export interface DialogueRatio {
  dialogue: number
  narration: number
}

const SPACE = /\s/u

/**
 * 段落のプレーン文字列（記法を解いた文字）で数える。空白（全角空白を含む）は数えない。
 * 括弧の記号はセリフに数える。文字はコードポイント単位（サロゲートペアは 1 文字）。
 */
export function dialogueRatio(blocks: ReadonlyArray<Block>): DialogueRatio {
  let dialogue = 0
  let narration = 0
  for (const block of blocks) {
    const text = plainTextOfBlock(block)
    const inside = insideQuotes(text)
    let i = 0
    for (const ch of text) {
      if (!SPACE.test(ch)) {
        if (inside[i]) dialogue++
        else narration++
      }
      i += ch.length
    }
  }
  return { dialogue, narration }
}

export function addRatio(a: DialogueRatio, b: DialogueRatio): DialogueRatio {
  return { dialogue: a.dialogue + b.dialogue, narration: a.narration + b.narration }
}

/** セリフの割合（0〜100 の整数・四捨五入）。文字が無ければ 0。 */
export function dialoguePercent(r: DialogueRatio): number {
  const total = r.dialogue + r.narration
  return total === 0 ? 0 : Math.round((r.dialogue / total) * 100)
}
