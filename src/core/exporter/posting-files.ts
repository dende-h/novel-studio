import encoding from 'encoding-japanese'
import { decodeDataUrl } from '../image'
import type { Episode, Work } from '../schema'
import { illustrationReferences } from '../sites/illustrations'
import { type PostingSiteId, postingProfile } from '../sites/portability'
import { type ZipInput, zipStore } from '../zip'
import { type PostingOptions, type PostingResult, toPostingSite } from './toPostingSite'

export interface PostingTextFormat {
  encoding: 'utf-8' | 'shift_jis' | 'euc-jp' | 'iso-2022-jp'
  newline: 'lf' | 'crlf'
  bom: boolean
}

export const DEFAULT_POSTING_TEXT_FORMAT: PostingTextFormat = {
  encoding: 'utf-8',
  newline: 'lf',
  bom: false,
}
const japaneseEncodings = { shift_jis: 'SJIS', 'euc-jp': 'EUCJP', 'iso-2022-jp': 'JIS' } as const

export function encodePostingText(text: string, format: PostingTextFormat): Uint8Array {
  const value = format.newline === 'crlf' ? text.replaceAll('\n', '\r\n') : text
  if (format.encoding === 'utf-8')
    return new TextEncoder().encode((format.bom ? '\ufeff' : '') + value)
  const bytes = Uint8Array.from(
    encoding.convert(encoding.stringToCode(value), {
      from: 'UNICODE',
      to: japaneseEncodings[format.encoding],
      type: 'array',
    }),
  )
  if (new TextDecoder(format.encoding, { fatal: true }).decode(bytes) !== value) {
    throw new Error('選んだ文字コードで表せない文字があります。UTF-8を選んでください')
  }
  return bytes
}

export function safePostingName(name: string): string {
  const printable = Array.from(name, (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? '_' : character
  }).join('')
  const trimmed = printable
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return [...trimmed].slice(0, 70).join('') || '原稿'
}

const numberName = (i: number) => String(i + 1).padStart(4, '0')
export const postingZipTitle = (episode: Episode, i: number) =>
  `${numberName(i)}_${safePostingName(episode.title)}`
export const episodeTxtName = (episode: Episode) => `${safePostingName(episode.title)}.txt`

export function postingEpisodeBytes(
  result: PostingResult,
  site: PostingSiteId,
  format: PostingTextFormat,
) {
  const bytes = encodePostingText(result.text, format)
  const max = postingProfile(site).maxBytes
  if (max && bytes.length > max)
    throw new Error(`投稿先で読み込めるファイルは${max.toLocaleString('ja-JP')} Bまでです`)
  return bytes
}

export function postingEpisodesZip(
  episodes: Episode[],
  site: PostingSiteId,
  format: PostingTextFormat,
  options: PostingOptions,
) {
  const max = postingProfile(site).maxEpisodes
  if (max && episodes.length > max) throw new Error(`投稿先で一度に読み込めるのは${max}話までです`)
  return zipStore(
    episodes.map((episode, i) => ({
      path: `${postingZipTitle(episode, i)}.txt`,
      data: postingEpisodeBytes(toPostingSite(episode.blocks, site, options), site, format),
    })),
    { utf8Names: true },
  )
}

const metadataLine = (value: string) => value.replace(/\r\n?|\n/g, ' ')

export function kakuyomuWorkZip(work: Work, options: PostingOptions = {}): Uint8Array {
  if (work.episodes.length > 9999) throw new Error('このZIPでは9,999話まで書き出せます')
  const contents = [
    `〖タイトル〗\n${metadataLine(work.title)}`,
    work.author && `〖作者名〗\n${metadataLine(work.author)}`,
    work.description && `〖紹介文〗\n${work.description}`,
    '〖目次〗\n' +
      work.episodes
        .map((episode, i) => `${i + 1}. ${metadataLine(episode.title) || `第${i + 1}話`}`)
        .join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
  const files = work.episodes.map((episode, i) => {
    const { text } = toPostingSite(episode.blocks, 'kakuyomu', options)
    if (!text.trim())
      throw new Error(`本文が空の話があります。「${episode.title}」を確認してください`)
    return {
      path: `episode_${numberName(i)}.txt`,
      data:
        '〖タイトル〗\n' +
        (metadataLine(episode.title) || `第${i + 1}話`) +
        '\n\n〖公開状態〗\n下書き\n\n〖本文（' +
        text.split('\n').length +
        '行）〗\n' +
        text,
    }
  })
  return zipStore([{ path: 'about.txt', data: contents }, ...files], { utf8Names: true })
}

export function importedIllustrationsZip(work: Work) {
  const positions: string[] = []
  for (const episode of work.episodes) {
    episode.blocks.forEach((block, i) => {
      block.inlines.forEach((inline) => {
        if (inline.type !== 'text') return
        for (const ref of illustrationReferences(inline.text))
          positions.push(`${episode.title}　${i + 1}行目　${ref.name}`)
      })
    })
  }
  const assets: ZipInput[] = (work.manuscriptImport?.assets ?? []).map(({ path, image }, i) => {
    const mime = /^data:image\/(png|jpeg|gif|webp);base64,/.exec(image)
    const base = (path.split('/').at(-1) ?? '挿絵').replace(/\.[^.]+$/, '')
    const name = `挿絵/${numberName(i)}_${safePostingName(base)}.${mime?.[1] ?? 'png'}`
    return { path: name, data: decodeDataUrl(image) }
  })
  for (const [i, asset] of (work.manuscriptImport?.assets ?? []).entries())
    positions.push(`${asset.path.split('/').slice(1).join('/')} → ${assets[i]?.path}`)
  return zipStore([{ path: '挿絵の位置.txt', data: positions.join('\n') }, ...assets], {
    utf8Names: true,
  })
}
