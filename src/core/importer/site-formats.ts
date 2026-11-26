import type { PostingSiteId } from '../sites/portability'
import { baseName, sortSourcesNatural } from './split'

export interface ManuscriptEpisode {
  title: string
  body: string
  path: string
  origin?: string
  site?: PostingSiteId
  chapter?: string
  before?: string
  after?: string
  details?: string
  pages?: string
  frontMatter?: boolean
}

export interface ManuscriptAsset {
  path: string
  data: Uint8Array
}

export interface ManuscriptSource {
  name: string
  title: string
  author?: string
  description?: string
  episodes: ManuscriptEpisode[]
  warnings: string[]
  details?: string
  assets?: ManuscriptAsset[]
  expandedBytes?: number
  structured: boolean
}

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const fileTitle = (path: string) => baseName(fileName(path))
export const field = (text: string, heading: string) =>
  new RegExp(`(?:^|\\n)${heading}\\n([^\\n]*)`).exec(text)?.[1]
const byName = (paths: string[]) =>
  sortSourcesNatural(paths.map((name) => ({ name }))).map(({ name }) => name)

const bodyField = (text: string, prefix: RegExp, strictHeader = false) => {
  const lines = text.split('\n')
  // エピソードの各メタデータは1行見出しと値で構成される。
  let index = 0
  while (index < lines.length && !prefix.test(lines[index] ?? '')) {
    const line = lines[index] ?? ''
    if (!strictHeader || !line.trim()) index += 1
    else if (/^〖[^〗]+〗$/.test(line)) index += 2
    else throw new Error('本文の前の見出しを確認できません')
  }
  if (index >= lines.length - 1) throw new Error('本文の見出しがありません')
  return {
    header: lines.slice(0, index).join('\n'),
    body: lines.slice(index + 1).join('\n'),
    marker: lines[index]!,
  }
}

export function kakuyomuEpisode(path: string, text: string): ManuscriptEpisode {
  const { header, body, marker } = bodyField(text, /^〖本文[（(]\d+行[）)]〗$/, true)
  const lineCount = Number(/\d+/.exec(marker)?.[0])
  const actual = body.split('\n').length
  if (lineCount !== actual && !(body.endsWith('\n') && lineCount === actual - 1)) {
    throw new Error('本文の行数が見出しと一致しません')
  }
  if (!body.trim()) throw new Error('本文が空です')
  return {
    path,
    title: field(header, '〖タイトル〗') || fileTitle(path),
    body,
    site: 'kakuyomu',
    details: header.replace(/^〖タイトル〗\n[^\n]*(?:\n+|$)/, '').trim(),
  }
}

export function narouEpisodes(path: string, text: string): ManuscriptEpisode[] {
  const starts = [
    ...text.matchAll(/^-{2,}[ 　]*(?:第(\d+)部分|エピソード(\d+))開始[ 　]*-{2,}[ \t]*$/gm),
  ]
  const section = (part: string, number?: number): ManuscriptEpisode => {
    const bodyMarker = /^〖本文〗\n/gm.exec(part)
    if (!bodyMarker) throw new Error('なろうの本文欄が見つかりません')
    const header = part.slice(0, bodyMarker.index)
    const rest = part.slice(bodyMarker.index + bodyMarker[0].length)
    function supplement(value: string, marker: string) {
      const match = new RegExp(`^〖${marker}〗\\n`, 'm').exec(value)
      if (!match) return undefined
      return value
        .slice(match.index + match[0].length)
        .split(/\n〖[^〗\n]+〗(?:\n|$)/, 1)[0]
        ?.replace(/\n\n$/, '')
    }
    const afterMarker = /\n\n〖後書き〗\n/.exec(rest)
    const body = afterMarker ? rest.slice(0, afterMarker.index) : rest
    if (!body.trim()) throw new Error('なろうの本文が空です')
    return {
      path,
      body,
      site: 'narou',
      title:
        field(header, '〖(?:サブタイトル|エピソードタイトル)〗') ||
        (number === undefined ? field(header, '〖タイトル〗') || fileTitle(path) : `第${number}話`),
      chapter: field(header, '〖(?:章タイトル|大見出し|章)〗'),
      before: supplement(header, '前書き'),
      after: afterMarker ? rest.slice(afterMarker.index + afterMarker[0].length) : undefined,
      details: /_draftepisode\.txt$/i.test(path)
        ? '下書き'
        : field(header, '〖公開状態〗') || '公開原稿',
    }
  }
  if (!starts.length) return [section(text)]
  const found = new Set<number>()
  return starts
    .map((start, i) => {
      const number = Number(start[1] ?? start[2])
      if (!Number.isSafeInteger(number) || number < 1 || found.has(number))
        throw new Error('なろうの話番号を確認できません')
      found.add(number)
      const chunk = text.slice(start.index + start[0].length + 1, starts[i + 1]?.index)
      const withoutEnd = chunk.replace(
        /(?:\n\n)?\n-{2,}[ 　]*(?:第\d+部分|エピソード\d+)終了[ 　]*-{2,}[ \t]*(?:\n*)$/,
        '',
      )
      const part = starts[i + 1] ? withoutEnd.replace(/\n\n$/, '') : withoutEnd
      if (!/^〖(?:サブタイトル|エピソードタイトル|本文)〗$/m.test(part))
        throw new Error('なろうの話の構造を確認できません')
      return { number, episode: section(part, number) }
    })
    .sort((a, b) => a.number - b.number)
    .map(({ episode }) => episode)
}

export function akatsukiTextEpisode(path: string, text: string): ManuscriptEpisode {
  const withoutFooter = text.replace(
    /(?:\n{4}|\n{2})―{4,}\n[^\n]+\nhttps:\/\/(?:www\.)?akatsuki-novels\.com\/[^\s]+\n[^\n]+(?:\n)?$/,
    '',
  )
  const first = withoutFooter.indexOf('\n\n')
  if (first < 0) throw new Error('アカツキの話タイトルと本文の境界が見つかりません')
  let body = withoutFooter.slice(first + 2)
  let before: string | undefined
  let after: string | undefined
  const afterMarker = /\n{2,}［後書き］\n/.exec(body)
  if (afterMarker) {
    after = body.slice(afterMarker.index + afterMarker[0].length)
    body = body.slice(0, afterMarker.index)
  }
  const preface = /^\n*［前書き］\n([\s\S]*)$/.exec(body)
  if (preface) {
    const main = /\n{2,}［本文］\n/.exec(preface[1]!)
    if (main) {
      before = preface[1]!.slice(0, main.index)
      body = preface[1]!.slice(main.index + main[0].length)
    }
  }
  if (!body.trim()) throw new Error('アカツキの本文が空です')
  return {
    path,
    title: withoutFooter.slice(0, first) || fileTitle(path),
    body,
    site: 'akatsuki',
    before,
    after,
  }
}

function contents(text: string) {
  const rows: { number: number; title: string; chapter: string }[] = []
  let chapter = ''
  let section = ''
  for (const line of text.split('\n')) {
    const heading = /^([ \t]*)(§+)\s*(.+)$/.exec(line)
    if (heading?.[3]) {
      if (heading[1] || heading[2] === '§§') section = heading[3]
      else {
        chapter = heading[3]
        section = ''
      }
      continue
    }
    const row = /^\s*(?:\[)?(\d+)(?:[.．:：、)\]]\s*|\s+)(\S.*)$/.exec(line)
    if (row)
      rows.push({
        number: Number(row[1]),
        title: row[2]!.trim(),
        chapter: [chapter, section].filter(Boolean).join(' ／ '),
      })
  }
  return rows
}

function matchContents<T>(
  rows: ReturnType<typeof contents>,
  members: Map<number, T>,
  name: string,
) {
  if (
    !rows.length ||
    rows.length !== members.size ||
    new Set(rows.map((row) => row.number)).size !== rows.length ||
    rows.some((row) => !members.has(row.number))
  ) {
    throw new Error(`${name}の目次と話ファイルが一致しません`)
  }
  return rows.map((row) => ({ ...row, member: members.get(row.number)! }))
}

function indexed(paths: string[], pattern: RegExp) {
  const members = new Map<number, string>()
  for (const path of paths) {
    const match = pattern.exec(fileName(path))
    if (!match) continue
    const number = Number(match[1])
    if (!number || !Number.isSafeInteger(number) || members.has(number))
      throw new Error('話の連番が重複しているか無効です')
    members.set(number, path)
  }
  return members
}

export const unconfirmedLayout =
  '公開資料で未確認の書式です。話タイトル・順序・本文を確認してください。'

export function readTextGroup(name: string, files: Map<string, string>): ManuscriptSource {
  const paths = byName([...files.keys()])
  const get = (path: string) => files.get(path)!
  const source: ManuscriptSource = {
    name,
    title: fileTitle(name),
    episodes: [],
    warnings: [],
    structured: false,
  }
  const aboutPath = paths.find((path) => /^about\.txt$/i.test(fileName(path)))
  const about = aboutPath ? get(aboutPath) : ''
  const kakuyomu = indexed(paths, /^episode_(\d{4})\.txt$/i)
  const novelup = indexed(paths, /^episode_(\d{5,})\.txt$/i)
  const akatsukiToc = paths.find((path) => fileName(path) === '0000_目次.txt')
  if (/^〖(?:タイトル|目次)〗$/m.test(about)) {
    source.structured = true
    const toc = /(?:^|\n)〖目次〗\n([\s\S]*)/.exec(about)?.[1] ?? ''
    if (!toc || kakuyomu.size === 0) throw new Error('カクヨムの目次または話ファイルがありません')
    source.title = field(about, '〖(?:タイトル|作品タイトル)〗') || source.title
    source.author = field(about, '〖(?:著者|作者|作者名|著者名|ユーザー名)〗')
    source.description = /(?:^|\n)〖(?:紹介文|あらすじ)〗\n([\s\S]*?)(?=\n+〖|$)/.exec(about)?.[1]
    source.details = about
    source.episodes = matchContents(contents(toc), kakuyomu, 'カクヨム').map(
      ({ member, chapter }) => ({
        ...kakuyomuEpisode(member, get(member)),
        chapter,
      }),
    )
  } else if (akatsukiToc) {
    source.structured = true
    const toc = get(akatsukiToc)
    const heading = toc.indexOf('\n［目次］\n')
    if (heading < 0) throw new Error('アカツキの目次を読み込めません')
    const metadata = toc.slice(0, heading).split('\n')
    source.title = metadata[0] || source.title
    source.author = metadata[1]?.trim() || undefined
    source.description = metadata.slice(3).join('\n').trim() || undefined
    const members = indexed(paths, /^(\d{4,})_(?!目次\.txt$).+\.txt$/i)
    if (!members.size) throw new Error('アカツキの話ファイルがありません')
    source.episodes = matchContents(contents(toc.slice(heading + 6)), members, 'アカツキ')
      .sort((a, b) => a.number - b.number)
      .map(({ member, title }) => {
        const episode = akatsukiTextEpisode(member, get(member))
        if (episode.title.trim() !== title)
          source.warnings.push(`${member}の話タイトルが目次と異なります`)
        return episode
      })
    source.warnings.push('前書きと本文が空行だけで区切られている場合は、まとめて本文に残ります。')
  } else if (novelup.size || /^# タイトル$/m.test(about)) {
    source.structured = true
    source.warnings.push(unconfirmedLayout)
    const isTales = !novelup.size
    const mockTales = indexed(paths, /^(?:mock_)?episode_(\d{4,})\.txt$/i)
    const members = isTales ? mockTales : novelup
    if (!members.size)
      throw new Error('仮書式の話ファイルを確認できません。本文TXTか貼り付けで取り込めます')
    const mockInfo = paths.find((path) => fileName(path) === 'mock-work-info.txt')
    source.title =
      (isTales ? field(about, '# タイトル') : mockInfo && get(mockInfo).split('\n')[0]) ||
      source.title
    source.episodes = [...members]
      .sort(([a], [b]) => a - b)
      .map(([, path]) => {
        const { header, body } = bodyField(get(path), isTales ? /^# 本文$/ : /^本文[：:]$/)
        if (!body.trim()) throw new Error(`本文が空です（${path}）`)
        return {
          path,
          body,
          title: field(header, isTales ? '# エピソードタイトル' : '話名[：:]') || fileTitle(path),
          site: isTales ? 'tales' : 'novelup',
          details: header,
        }
      })
  } else {
    for (const path of paths) {
      const text = get(path)
      if (/^n\d{4}[a-z]{1,2}_(?:review|impression)\.txt$/i.test(fileName(path))) continue
      const narou =
        /^n\d{4}[a-z]{1,2}(?:_draftepisode)?\.txt$/i.test(fileName(path)) ||
        /^〖Nコード〗$/m.test(text) ||
        /^-{2,} *(?:第\d+部分|エピソード\d+)開始 *-{2,}$/m.test(text)
      try {
        if (narou) {
          source.structured = true
          source.title = field(text, '〖タイトル〗') || source.title
          source.author ??= field(text, '〖(?:作者名|作者)〗')
          source.description ??= /(?:^|\n)〖あらすじ〗\n([\s\S]*?)(?=\n+〖|\n-{2,}|$)/.exec(
            text,
          )?.[1]
          const meta = text
            .split(/^-{2,}.*開始.*-{2,}$/m, 1)[0]
            ?.split(/^〖本文〗$/m, 1)[0]
            ?.trim()
          if (meta && /^〖Nコード〗$/m.test(meta)) source.details = meta
          const origin = field(text, '〖タイトル〗')
          source.episodes.push(
            ...narouEpisodes(path, text).map((episode) => ({ ...episode, origin })),
          )
        } else if (
          (/^episode_\d{4}\.txt$/i.test(fileName(path)) &&
            /^(?:〖タイトル〗|〖本文[（(])/m.test(text)) ||
          (/^〖タイトル〗\n/.test(text) && /^〖本文[（(]/m.test(text))
        ) {
          source.structured = true
          source.episodes.push(kakuyomuEpisode(path, text))
        } else {
          source.episodes.push({ path, title: fileTitle(path), body: text })
        }
      } catch (error) {
        throw new Error(
          `${path} — ${error instanceof Error ? error.message : '本文を読み込めません'}`,
          { cause: error },
        )
      }
    }
  }
  if (!source.episodes.length) throw new Error('取り込める原稿が見つかりません')
  return source
}
