import { insideQuotes } from '../quotes'
import type { MorphToken } from './token'

/**
 * 文末の偏り（地の文）。地の文の文を、終わり方で4つに分けて数える。
 * - ta：「〜た」（「歩いた」「だった」「読んだ」）
 * - present：「〜る・〜い・〜だ」など（た以外の動詞・形容詞・助動詞で終わる）
 * - noun：体言止め（名詞で終わる）
 * - other：そのほか（助詞で終わる倒置、括弧の中の語で終わる文など）
 * 文の区切りは括弧の外の「。」と段落の終わり。セリフ（括弧の中）だけの段落は数えない。
 */
export type EndingKind = 'ta' | 'present' | 'noun' | 'other'
export const ENDING_KINDS: readonly EndingKind[] = ['ta', 'present', 'noun', 'other']

/** 同じ文末が続いたと見なす文の数（初期値）。 */
export const ENDING_RUN_MIN = 4

export interface SentenceEnding {
  block: number
  kind: EndingKind
  /** 文末の語の位置（段落のプレーン文字列の UTF-16 位置）。本文のマーカーに使う。 */
  start: number
  end: number
}

export interface EndingStats {
  endings: SentenceEnding[]
  counts: Record<EndingKind, number>
  /**
   * 同じ文末が ENDING_RUN_MIN 文以上続いたところ（「そのほか」は続きに数えない）。
   * 続きは段落をまたぐが、セリフだけの段落を挟むと切る（会話で調子が変わるため）。
   */
  runs: SentenceEnding[][]
}

export const emptyEndingCounts = (): Record<EndingKind, number> => ({
  ta: 0,
  present: 0,
  noun: 0,
  other: 0,
})

function kindOf(t: MorphToken): EndingKind {
  if (t.pos === '助動詞' && t.base === 'た') return 'ta'
  if (t.pos === '名詞') return 'noun'
  if (t.pos === '動詞' || t.pos === '形容詞' || t.pos === '助動詞') return 'present'
  return 'other'
}

const isSkippable = (t: MorphToken) => t.pos === '記号' || !t.surface.trim()

/** 段落ごとの文の区切り（括弧の外の「。」の位置と、括弧の外で終わる段落の終わり）。 */
function boundsOf(text: string, inside: readonly boolean[]): number[] {
  const bounds: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] === '。' && !inside[i]) bounds.push(i)
  let last = text.length - 1
  while (last >= 0 && !(text[last] as string).trim()) last--
  if (last >= 0 && text[last] !== '。' && !inside[last]) bounds.push(last + 1)
  return bounds
}

export function sentenceEndings(
  texts: readonly string[],
  tokensByBlock: ReadonlyArray<ReadonlyArray<MorphToken>>,
  minRun = ENDING_RUN_MIN,
): EndingStats {
  const endings: SentenceEnding[] = []
  const counts = emptyEndingCounts()
  const runs: SentenceEnding[][] = []
  let run: SentenceEnding[] = []
  const closeRun = () => {
    if (run.length >= minRun) runs.push(run)
    run = []
  }

  texts.forEach((text, block) => {
    if (!text.trim()) return
    const inside = insideQuotes(text)
    const bounds = boundsOf(text, inside)
    const mine: SentenceEnding[] = []
    let bi = 0
    let last: MorphToken | undefined
    const flush = () => {
      if (last) {
        const kind = inside[last.start] ? 'other' : kindOf(last)
        mine.push({ block, kind, start: last.start, end: last.end })
      }
      last = undefined
    }
    for (const t of tokensByBlock[block] ?? []) {
      while (bi < bounds.length && t.start >= (bounds[bi] as number)) {
        flush()
        bi++
      }
      if (bi >= bounds.length) break
      if (!isSkippable(t)) last = t
    }
    if (bi < bounds.length) flush()

    if (mine.length === 0) {
      closeRun() // セリフだけの段落
      return
    }
    for (const e of mine) {
      endings.push(e)
      counts[e.kind]++
      if (e.kind !== 'other' && run[0]?.kind === e.kind) {
        run.push(e)
      } else {
        closeRun()
        if (e.kind !== 'other') run = [e]
      }
    }
  })
  closeRun()
  return { endings, counts, runs }
}
