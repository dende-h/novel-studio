import { illustrationReferences } from '../sites/illustrations'
import { readArchive, validArchivePath } from '../zip/read'
import { linkedImage } from './local-image'
import { readAkatsukiHtml, readEpub } from './markup'
import {
  fileName,
  fileTitle,
  type ManuscriptAsset,
  type ManuscriptSource,
  readTextGroup,
} from './site-formats'
import { looksLikeText, MAX_IMPORT_BYTES, normalizeImportedText, readManuscriptText } from './text'

export interface LocalManuscriptFile {
  path: string
  data: Uint8Array
}
export type ManuscriptRead =
  | { name: string; source: ManuscriptSource }
  | { name: string; error: string }

function txt(path: string, bytes: Uint8Array) {
  try {
    return readManuscriptText(bytes)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '本文を読み込めません'
    throw new Error(`「${path}」 — ${message}`, { cause })
  }
}

export function readPastedManuscript(value: string): ManuscriptSource {
  const body = normalizeImportedText(value)
  if (!looksLikeText(body)) throw new Error('貼り付けた原稿に読み込めない文字があります')
  if (new TextEncoder().encode(body).length > MAX_IMPORT_BYTES)
    throw new Error('原稿は合計20 MBまで取り込めます')
  const source = readTextGroup('貼り付け', new Map([['貼り付け', body]]))
  if (!source.structured && source.episodes[0]) {
    source.title = '取り込んだ作品'
    source.episodes[0].title = ''
  }
  return source
}

function supportedGroups(files: Map<string, Uint8Array>) {
  const groups = new Map<string, Map<string, Uint8Array>>()
  for (const [path, data] of files) {
    if (path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')) continue
    if (!/\.(?:txt|html?)$/i.test(path)) continue
    if (/^n\d{4}[a-z]{1,2}_(?:review|impression)\.txt$/i.test(fileName(path))) continue
    const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
    const group = groups.get(parent) ?? new Map<string, Uint8Array>()
    group.set(path, data)
    groups.set(parent, group)
  }
  return groups
}

function parseGroup(
  name: string,
  files: Map<string, Uint8Array>,
  all: Map<string, Uint8Array>,
): ManuscriptSource {
  const index = [...files.keys()].find((path) => /(?:^|\/)nvl\d+\/index\.html?$/i.test(path))
  if (index) return readAkatsukiHtml(name, all, index)
  const texts = new Map(
    [...files]
      .filter(([path]) => /\.txt$/i.test(path))
      .map(([path, data]) => [path, txt(path, data)]),
  )
  const source = readTextGroup(name, texts)
  const assets = new Map<string, ManuscriptAsset>()
  for (const episode of source.episodes) {
    const parent = episode.path.slice(0, episode.path.lastIndexOf('/') + 1)
    const connect = (text: string) => {
      let result = ''
      let start = 0
      for (const ref of illustrationReferences(text)) {
        if (ref.site !== 'file') continue
        const relative = parent + ref.name.replace(/^\.\//, '')
        const path = all.has(relative) ? relative : ref.name
        if (!all.has(path)) continue
        result += text.slice(start, ref.offset) + linkedImage(path, all.get(path), assets)
        start = ref.offset + ref.raw.length
      }
      return result + text.slice(start)
    }
    episode.body = connect(episode.body)
    if (episode.before !== undefined) episode.before = connect(episode.before)
    if (episode.after !== undefined) episode.after = connect(episode.after)
  }
  if (assets.size) source.assets = [...assets.values()]
  return source
}

function mergeGroups(name: string, groups: ManuscriptSource[]): ManuscriptSource {
  const main = groups.find((group) => group.structured) ?? groups[0]
  if (!main) throw new Error('取り込める原稿が見つかりません')
  const structuredGroups = groups.filter((group) => group.structured)
  return {
    name,
    title: main.structured ? main.title : fileTitle(name),
    author: main.author,
    description: main.description,
    episodes: groups.flatMap((group) =>
      group.episodes.map((episode) => ({
        ...episode,
        origin: episode.origin ?? (group.structured ? group.title : undefined),
      })),
    ),
    structured: structuredGroups.length > 0,
    warnings: groups.flatMap((group) => group.warnings),
    details:
      groups
        .map((group) => group.details)
        .filter(Boolean)
        .join('\n\n') || undefined,
    assets: groups.flatMap((group) => group.assets ?? []),
  }
}

export async function readManuscriptArchive({
  path,
  data,
}: LocalManuscriptFile): Promise<ManuscriptSource> {
  const files = await readArchive(data, MAX_IMPORT_BYTES)
  const expandedBytes = Array.from(files.values()).reduce(
    (total, member) => total + member.length,
    0,
  )
  if (/\.epub$/i.test(path)) return { ...readEpub(path, files), expandedBytes }
  if (
    files.has('META-INF/container.xml') ||
    (files.has('mimetype') &&
      new TextDecoder().decode(files.get('mimetype')) === 'application/epub+zip')
  ) {
    throw new Error('中身がEPUB形式です。拡張子を .epub にして選んでください')
  }
  const groups = [...supportedGroups(files)].flatMap(([parent, group]) => {
    if (
      ![...group.keys()].some(
        (member) => /\.txt$/i.test(member) || /(?:^|\/)nvl\d+\/index\.html?$/i.test(member),
      )
    )
      return []
    return [parseGroup(parent || path, group, files)]
  })
  const merged = mergeGroups(path, groups)
  if (!merged.structured)
    merged.episodes.sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true }))
  return { ...merged, expandedBytes }
}

function readResult(name: string, read: () => ManuscriptSource): ManuscriptRead {
  try {
    return { name, source: read() }
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : 'ファイルを読み込めません' }
  }
}

export function readLooseManuscripts(inputs: LocalManuscriptFile[]): ManuscriptRead[] {
  const results: ManuscriptRead[] = []
  const files = new Map<string, Uint8Array>()
  for (const { path, data } of inputs) {
    if (!validArchivePath(path) || files.has(path)) {
      results.push({ name: path, error: '原稿に同じパスか無効なファイル名があります' })
    } else if (/\.(?:txt|html?|jpe?g|png|gif|webp)$/i.test(path)) files.set(path, data)
    else if (!path.includes('/') || !/\.(?:css|js)$/i.test(path)) {
      results.push({ name: path, error: 'TXT、原稿ZIP、PDF、EPUBを選んでください' })
    }
  }
  for (const [parent, group] of supportedGroups(files)) {
    const members = [...group.keys()]
    const grouped = members.some((path) =>
      /(?:^|\/)(?:about|0000_目次|episode_\d{5,})\.txt$|(?:^|\/)nvl\d+\/index\.html?$/i.test(path),
    )
    if (grouped)
      results.push(
        readResult(parent || members[0]!, () => parseGroup(parent || members[0]!, group, files)),
      )
    else
      for (const [path, data] of group) {
        results.push(readResult(path, () => parseGroup(path, new Map([[path, data]]), files)))
      }
  }
  return results.length
    ? results
    : [{ name: inputs[0]?.path ?? '', error: '取り込める原稿が見つかりません' }]
}

export function readSingleManuscript(path: string, bytes: Uint8Array): ManuscriptSource {
  if (!/\.txt$/i.test(path))
    throw new Error('TXTを1件選んでください。複数話はホームの「原稿を取り込む」から追加できます')
  const text = txt(path, bytes)
  return readTextGroup(path, new Map([[path, text]]))
}
