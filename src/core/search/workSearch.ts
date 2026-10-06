export interface SearchSource {
  episodeId: string
  title: string
  text: string
}

export interface SearchMatch {
  episodeId: string
  start: number
  end: number
  line: number
  occurrence: number
  /** Any overlap with [[...]], including its delimiters, is protected from replacement. */
  isReference: boolean
  excerpt: string
  excerptMatchStart: number
  excerptMatchEnd: number
}

export interface ReplacementPlan {
  episodeId: string
  before: string
  after: string
  count: number
}

/** Literal, case-sensitive, non-overlapping matches. Offsets use textarea's UTF-16 units. */
export function searchWork(sources: readonly SearchSource[], query: string): SearchMatch[] {
  if (!query || /[\r\n]/.test(query)) return []
  const matches: SearchMatch[] = []
  for (const source of sources) {
    // Like the notation parser, an unfinished reference extends to the end of its line.
    // Protect raw delimiters too, even inside decorated or malformed notation.
    const references = Array.from(source.text.matchAll(/\[\[[^\n]*?(?:\]\]|(?=\n|$))/g), (m) => ({
      start: m.index,
      end: m.index + m[0].length,
    }))
    let referenceIndex = 0
    let cursor = 0
    let line = 1
    let lineCursor = 0
    let occurrence = 0
    while (cursor <= source.text.length) {
      const start = source.text.indexOf(query, cursor)
      if (start < 0) break
      const end = start + query.length
      let reference = references[referenceIndex]
      while (reference && reference.end <= start) reference = references[++referenceIndex]
      while (lineCursor < start) {
        if (source.text.charCodeAt(lineCursor) === 10) line++
        lineCursor++
      }
      let left = Math.max(0, start - 30)
      let right = Math.min(source.text.length, end + 30)
      if (left > 0 && /[\uDC00-\uDFFF]/.test(source.text.charAt(left))) left--
      if (right < source.text.length && /[\uDC00-\uDFFF]/.test(source.text.charAt(right))) right++
      const prefix = left > 0 ? '…' : ''
      matches.push({
        episodeId: source.episodeId,
        start,
        end,
        line,
        occurrence: occurrence++,
        isReference: reference !== undefined && reference.start < end,
        excerpt:
          prefix +
          source.text.slice(left, right).replace(/[\r\n]/g, ' ') +
          (right < source.text.length ? '…' : ''),
        excerptMatchStart: prefix.length + start - left,
        excerptMatchEnd: prefix.length + end - left,
      })
      cursor = end
    }
  }
  return matches
}

export function planReplacement(
  sources: readonly SearchSource[],
  query: string,
  replacement: string,
  target: SearchMatch | 'all',
): ReplacementPlan[] {
  if (!query || query === replacement || /[\r\n]/.test(query + replacement)) return []
  const all = searchWork(sources, query)
  const selected =
    target === 'all'
      ? all
      : all.filter(
          (m) =>
            m.episodeId === target.episodeId &&
            m.start === target.start &&
            m.end === target.end &&
            m.occurrence === target.occurrence,
        )
  if (target !== 'all' && selected.length !== 1)
    throw new Error('本文が変わりました。検索し直してください')
  const matches = selected.filter((match) => !match.isReference)
  return sources.flatMap((source) => {
    const selected = matches.filter((m) => m.episodeId === source.episodeId)
    if (!selected.length) return []
    const pieces: string[] = []
    let cursor = 0
    for (const match of selected) {
      pieces.push(source.text.slice(cursor, match.start), replacement)
      cursor = match.end
    }
    pieces.push(source.text.slice(cursor))
    const after = pieces.join('')
    return [{ episodeId: source.episodeId, before: source.text, after, count: selected.length }]
  })
}
