import { bytesToDataUrl } from '../image'
import { type Episode, type Work, type WorkFormat, WorkSchema } from '../schema'
import { illustrationReferences } from '../sites/illustrations'
import type { SourceNotation } from '../sites/portability'
import type { ManuscriptAsset, ManuscriptEpisode, ManuscriptSource } from './site-formats'
import { parseExternalNotation } from './site-notation'
import { MAX_WORK_JSON_BYTES, workJsonBytes } from './text'

export function manuscriptBody(episode: ManuscriptEpisode, supplements: boolean) {
  return supplements
    ? [episode.before, episode.body, episode.after]
        .filter((part) => part !== undefined)
        .join('\n\n')
    : episode.body
}

export function manuscriptBlocks(
  episode: ManuscriptEpisode,
  notation: SourceNotation,
  supplements: boolean,
) {
  return parseExternalNotation(
    manuscriptBody(episode, supplements),
    notation === 'auto' ? (episode.site ?? 'auto') : notation,
  )
}

function assetData(asset: ManuscriptAsset): string {
  const bytes = asset.data
  const type =
    bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpeg' : bytes[0] === 0x47 ? 'gif' : 'webp'
  return bytesToDataUrl(bytes, `image/${type}`)
}

export function validateImportedWork(work: Work): Work {
  const validated = WorkSchema.parse(work)
  if (workJsonBytes(validated) > MAX_WORK_JSON_BYTES) {
    throw new Error('保存後の作品が20 MBを超えます。取り込む話を分けてください')
  }
  return validated
}

export function makePostingWork(
  input: {
    title: string
    author?: string
    description?: string
    format?: WorkFormat
    episodes: ManuscriptEpisode[]
    sources: ManuscriptSource[]
    notation: SourceNotation
    supplements: boolean
  },
  genId: () => string,
  now: () => number,
): Work {
  const episodes: Episode[] = input.episodes.map((episode, index) => ({
    id: genId(),
    title: episode.title.trim() ? episode.title : `第${index + 1}話`,
    blocks: manuscriptBlocks(episode, input.notation, input.supplements),
  }))
  const refs = new Set(
    input.episodes.flatMap((episode) =>
      illustrationReferences(manuscriptBody(episode, true))
        .filter((ref) => ref.site === 'file')
        .map((ref) => ref.assetPath ?? ref.name),
    ),
  )
  const assets = input.sources
    .flatMap((source) => source.assets ?? [])
    .filter((asset) => refs.has(asset.path))
    .map((asset) => ({ path: asset.path, image: assetData(asset) }))
  const sourceNotes = input.sources
    .filter((source) => source.details || source.warnings.length)
    .map((source) => [source.name, source.details, ...source.warnings].filter(Boolean).join('\n'))
  const episodeNotes = input.episodes.flatMap((episode) => {
    const details = [
      episode.chapter && `章 ${episode.chapter}`,
      episode.details,
      episode.pages && `PDF ${episode.pages} ページ`,
      episode.before && `［前書き］\n${episode.before}`,
      episode.after && `［後書き］\n${episode.after}`,
    ].filter(Boolean)
    return details.length ? [[episode.title, episode.path, ...details].join('\n')] : []
  })
  const notes = [...sourceNotes, ...episodeNotes].join('\n\n')
  return validateImportedWork({
    id: genId(),
    title: input.title,
    author: input.author || undefined,
    description: input.description || undefined,
    ...(input.format === 'script' ? { format: input.format } : {}),
    episodes,
    updatedAt: now(),
    ...(notes || assets.length ? { manuscriptImport: { notes, assets } } : {}),
  })
}
