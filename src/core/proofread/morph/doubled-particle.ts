import type { MorphHit } from './hit'
import type { MorphToken } from './token'

/**
 * 一文の中の同じ助詞（COT-40 FR-8b）。
 * 同じ文の中で、同じ助詞（表層形と細分類1が同じ）が、間に別の助詞も読点も述語も挟まずに 2 回出たら 1 件。
 * 述語（動詞・形容詞・助動詞）を挟むと、2 つの助詞は別の節に属する（「何かが動いた気がした」）ので出さない。
 * 隣り合う「がが」は「同じ語の連続」（rules.ts）に任せる。文の区切りは「。！？」と括弧の出入り。
 */
const TARGET: Record<string, ReadonlySet<string>> = {
  格助詞: new Set(['が', 'を', 'に', 'で', 'へ', 'から', 'より']),
  係助詞: new Set(['は']),
}
const SENTENCE_BREAK = new Set([
  '。',
  '！',
  '？',
  '!',
  '?',
  '「',
  '」',
  '『',
  '』',
  '（',
  '）',
  '(',
  ')',
])

const isTarget = (t: MorphToken) => t.pos === '助詞' && (TARGET[t.pos1]?.has(t.surface) ?? false)
const PREDICATE = new Set(['動詞', '形容詞', '助動詞'])

export function doubledParticleHits(tokens: ReadonlyArray<MorphToken>, text: string): MorphHit[] {
  const hits: MorphHit[] = []
  let prev: { token: MorphToken; index: number } | null = null
  tokens.forEach((t, i) => {
    if (
      SENTENCE_BREAK.has(t.surface) ||
      (t.pos === '記号' && t.pos1 === '読点') ||
      PREDICATE.has(t.pos)
    ) {
      prev = null
      return
    }
    if (t.pos !== '助詞') return
    if (!isTarget(t)) {
      prev = null
      return
    }
    if (
      prev &&
      prev.token.surface === t.surface &&
      prev.token.pos1 === t.pos1 &&
      i - prev.index > 1
    ) {
      const start = prev.token.start
      hits.push({
        start,
        end: t.end,
        text: text.slice(start, t.end),
        message: `同じ文の中で「${t.surface}」が続いています。言い換えると読みやすくなることがあります。`,
      })
    }
    prev = { token: t, index: i }
  })
  return hits
}
