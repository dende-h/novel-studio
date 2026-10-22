import type { MorphToken } from './token'

/** よく使う言葉（COT-40 FR-9a）。副詞と形容詞（自立）を原形で数え、多い順に返す。 */
export interface FrequentWord {
  base: string
  count: number
  /** 1万字あたりの回数（小数第1位まで）。 */
  per10k: number
}

export function isFrequentTarget(t: MorphToken, excluded: ReadonlySet<string>): boolean {
  if (!t.base || t.base === '*' || excluded.has(t.base)) return false
  if ([...t.base].length < 2) return false
  return t.pos === '副詞' || (t.pos === '形容詞' && t.pos1 === '自立')
}

export function frequentWords(
  tokensByBlock: Iterable<ReadonlyArray<MorphToken>>,
  totalChars: number,
  excluded: ReadonlySet<string>,
  limit = 10,
): FrequentWord[] {
  const counts = new Map<string, number>()
  for (const tokens of tokensByBlock) {
    for (const t of tokens) {
      if (isFrequentTarget(t, excluded)) counts.set(t.base, (counts.get(t.base) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .slice(0, limit)
    .map(([base, count]) => ({
      base,
      count,
      per10k: totalChars > 0 ? Math.round((count / totalChars) * 100000) / 10 : 0,
    }))
}

const NO_EXCLUDED: ReadonlySet<string> = new Set()

/**
 * その語（原形）が出る箇所を段落ごとに返す（本文のマーカー用）。数えた語と同じ判定で拾うので、
 * 活用した形（「小さい」→「小さく」）にも付き、別の語の一部（「ふと」→「ふとん」）には付かない。
 */
export function frequentWordRanges(
  tokensByBlock: ReadonlyArray<ReadonlyArray<MorphToken>>,
  base: string,
): { start: number; end: number }[][] {
  return tokensByBlock.map((tokens) =>
    tokens
      .filter((t) => t.base === base && isFrequentTarget(t, NO_EXCLUDED))
      .map((t) => ({ start: t.start, end: t.end })),
  )
}
