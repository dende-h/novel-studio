import { isHeadingLine } from '@/core/importer'
import type { ManuscriptEpisode, ManuscriptSource } from '@/core/importer/site-formats'

export type ManuscriptSplit = 'files' | 'heading' | 'whole'

export function splitHeadings(episode: ManuscriptEpisode): ManuscriptEpisode[] {
  const lines = episode.body.split('\n')
  const headings = lines.flatMap((line, index) => {
    const chapter = /^\[chapter:(.+)\]$/.exec(line.trim())
    return chapter
      ? [{ index, title: chapter[1]! }]
      : isHeadingLine(line)
        ? [{ index, title: line.trim() }]
        : []
  })
  if (!headings.length) return [episode]
  const result = []
  const before = lines.slice(0, headings[0]!.index).join('\n')
  if (before.trim()) result.push({ ...episode, body: before })
  headings.forEach(({ index, title }, i) => {
    const body = lines.slice(index + 1, headings[i + 1]?.index).join('\n')
    const named =
      /^第[0-9０-９〇零一二三四五六七八九十百千]+話[ 　]+(.+)$/.exec(title)?.[1] ?? title
    result.push({ ...episode, title: named, body })
  })
  return result.length ? result : [episode]
}

export function joinEpisodes(first: ManuscriptEpisode, next: ManuscriptEpisode): ManuscriptEpisode {
  return {
    ...first,
    site: first.site === next.site ? first.site : undefined,
    body: `${first.body}\n\n${next.body}`,
    before:
      [first.before, next.before].filter((value) => value !== undefined).join('\n\n') || undefined,
    after:
      [first.after, next.after].filter((value) => value !== undefined).join('\n\n') || undefined,
    details: [first.details, next.details].filter(Boolean).join('\n\n') || undefined,
  }
}

export function splitManuscripts(
  sources: { id: number; source: ManuscriptSource }[],
  split: ManuscriptSplit,
  title: string,
) {
  const items = sources.flatMap(({ id, source }) => {
    const episodes =
      split === 'heading' && !source.structured
        ? source.episodes.flatMap(splitHeadings)
        : source.episodes
    return episodes.map((episode, index) => ({
      episode,
      id: `${id}-${index}`,
      group: episode.origin ?? source.title,
    }))
  })
  if (split !== 'whole' || !items.length) return items
  const first = items[0]!
  const episode = items
    .slice(1)
    .reduce((current, next) => joinEpisodes(current, next.episode), first.episode)
  return [{ ...first, episode: { ...episode, title, frontMatter: false } }]
}

export function seemsMultiEpisode(episode: ManuscriptEpisode): boolean {
  return (
    (episode.body.match(
      /^(?:\[chapter:[^\]\n]+\]|第[0-9０-９〇零一二三四五六七八九十百千]+話(?:$|[ 　：:]))/gm,
    )?.length ?? 0) > 1
  )
}
