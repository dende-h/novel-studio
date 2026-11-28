import { illustrationReferences } from '../sites/illustrations'
import { readArchive, validArchivePath } from '../zip/read'
import { linkedImage } from './local-image'
import { isEpubMimetype, readAkatsukiHtml, readEpub } from './markup'
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
export interface ManuscriptInput {
  path: string
  bytes: number
}
export type ManuscriptRead = { name: string; inputs: ManuscriptInput[] } & (
  | { source: ManuscriptSource }
  | { error: string }
  | { skipped: true }
)

export function manuscriptBytes(rows: { inputs: ManuscriptInput[]; source?: ManuscriptSource }[]) {
  const inputs = new Map<string, number>()
  let expanded = 0
  for (const row of rows) {
    for (const file of row.inputs) {
      const path = file.path.normalize('NFC')
      inputs.set(path, Math.max(inputs.get(path) ?? 0, file.bytes))
    }
    if (row.source?.expandedBytes !== undefined) {
      const raw = row.inputs.reduce((sum, file) => sum + file.bytes, 0)
      expanded += Math.max(0, row.source.expandedBytes - raw)
    }
  }
  return [...inputs.values()].reduce((sum, bytes) => sum + bytes, expanded)
}

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
        const relative = (parent + ref.name.replace(/^\.\//, '')).normalize('NFC')
        const path = all.has(relative) ? relative : ref.name.normalize('NFC')
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

export async function readManuscriptArchive(
  { path, data }: LocalManuscriptFile,
  signal?: AbortSignal,
): Promise<ManuscriptSource> {
  const files = await readArchive(data, MAX_IMPORT_BYTES, signal)
  const expandedBytes = Array.from(files.values()).reduce(
    (total, member) => total + member.length,
    0,
  )
  if (/\.epub$/i.test(path)) return { ...readEpub(path, files), expandedBytes }
  if (files.has('META-INF/container.xml') || isEpubMimetype(files.get('mimetype'))) {
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

export function manuscriptReadError(
  name: string,
  inputs: ManuscriptInput[],
  error: unknown,
): ManuscriptRead {
  return { name, inputs, error: error instanceof Error ? error.message : '原稿を読み込めません' }
}

export function readLooseManuscripts(inputs: LocalManuscriptFile[]): ManuscriptRead[] {
  const results: ManuscriptRead[] = []
  const files = new Map<string, Uint8Array>()
  const original = new Map<string, ManuscriptInput>()
  const accounted = new Set<string>()
  for (const { path, data } of inputs) {
    const key = path.normalize('NFC')
    const input = { path, bytes: data.length }
    if (!validArchivePath(path) || original.has(key)) {
      results.push({
        name: path,
        inputs: [input],
        error: '原稿に同じパスか無効なファイル名があります',
      })
      continue
    }
    original.set(key, input)
    if (/\.(?:txt|html?|jpe?g|png|gif|webp)$/i.test(key)) files.set(key, data)
    else if (!key.includes('/') || !/\.(?:css|js)$/i.test(key)) {
      accounted.add(key)
      results.push({
        name: path,
        inputs: [input],
        error: 'TXT、原稿ZIP、PDF、EPUBを選んでください',
      })
    }
  }

  function addGroup(name: string, group: Map<string, Uint8Array>) {
    const assigned = [...group.keys()]
    let result: ManuscriptRead
    try {
      const source = parseGroup(name, group, files)
      for (const asset of source.assets ?? [])
        assigned.push(asset.path.slice(asset.path.indexOf('/') + 1))
      result = { name, inputs: [], source }
    } catch (error) {
      result = manuscriptReadError(name, [], error)
    }
    for (const path of new Set(assigned)) {
      const file = original.get(path)
      if (file) {
        result.inputs.push(file)
        accounted.add(path)
      }
    }
    results.push(result)
  }

  for (const [parent, group] of supportedGroups(files)) {
    const members = [...group.keys()]
    const grouped = members.some((path) =>
      /(?:^|\/)(?:about|0000_目次|episode_\d{5,})\.txt$|(?:^|\/)nvl\d+\/index\.html?$/i.test(path),
    )
    const hasKakuyomuToc =
      members.some((path) => /^toc\.txt$/i.test(fileName(path))) &&
      members.some((path) => /^episode_\d{4}\.txt$/i.test(fileName(path)))
    if (grouped || hasKakuyomuToc) addGroup(parent || members[0] || '', group)
    else for (const [path, data] of group) addGroup(path, new Map([[path, data]]))
  }
  const skipped = [...original].flatMap(([path, file]) => (accounted.has(path) ? [] : [file]))
  if (!results.length) {
    return [
      { name: skipped[0]?.path ?? '', inputs: skipped, error: '取り込める原稿が見つかりません' },
    ]
  }
  if (skipped.length) {
    results.push({
      name: skipped.length === 1 ? (skipped[0]?.path ?? '') : '取込対象外のファイル',
      inputs: skipped,
      skipped: true,
    })
  }
  return results
}

export async function readManuscriptFiles(files: LocalManuscriptFile[], signal?: AbortSignal) {
  const results: ManuscriptRead[] = []
  const loose: LocalManuscriptFile[] = []
  for (const file of files) {
    signal?.throwIfAborted()
    if (!/\.(?:zip|epub)$/i.test(file.path)) {
      loose.push(file)
      continue
    }
    const inputs = [{ path: file.path, bytes: file.data.length }]
    try {
      results.push({ name: file.path, inputs, source: await readManuscriptArchive(file, signal) })
    } catch (error) {
      signal?.throwIfAborted()
      results.push(manuscriptReadError(file.path, inputs, error))
    }
  }
  signal?.throwIfAborted()
  return [...results, ...(loose.length ? readLooseManuscripts(loose) : [])]
}

export function readSingleManuscript(path: string, bytes: Uint8Array): ManuscriptSource {
  if (!/\.txt$/i.test(path))
    throw new Error('TXTを1件選んでください。複数話はホームの「原稿を取り込む」から追加できます')
  const text = txt(path, bytes)
  return readTextGroup(path, new Map([[path, text]]))
}
