/**
 * 取り込んだテキストを「話」に分ける純関数群。
 * 見出し行（「第1話」など）・区切り行（罫線）・ファイル単位の 3 通りと、プレビュー上の手直し
 * （タイトル変更・前の話とつなげる）を扱う。本文のパース（parseEpisodeBody）はここでは行わない。
 */

export type SplitMode = 'heading' | 'file' | 'none'

export interface ImportSource {
  /** ファイル名。貼り付けは空文字。 */
  name: string
  /** normalize 済み（LF・BOM なし）の本文。 */
  text: string
}

export interface SplitOptions {
  mode: SplitMode
  /** 罫線だけの行（--- や ＊＊＊）でも分ける。既定 false（場面転換の「＊＊＊」を話にしないため）。 */
  separators: boolean
  /** 見出し行を本文にも残す。既定 false（見出しはタイトルになる）。 */
  keepHeadingInBody: boolean
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = {
  mode: 'heading',
  separators: false,
  keepHeadingInBody: false,
}

export type SplitReason = 'heading' | 'separator' | 'file' | 'preamble' | 'whole'

export interface SplitEpisode {
  title: string
  body: string
  reason: SplitReason
  sourceName: string
  /** 元テキスト内で、この話が始まる行番号（0 始まり）。手直しの安定キーに使う。 */
  sourceLine: number
}

export interface SplitResult {
  episodes: SplitEpisode[]
  /** 見出し行が 1 つでも見つかったか（「見出しが見つからなかった」案内の判定用）。 */
  headingFound: boolean
}

/** 見出し行とみなす最大長（trim 後）。本文の普通の一文を見出しにしないための足切り。 */
export const HEADING_MAX_LENGTH = 40

const NUM = '[0-9０-９〇零一二三四五六七八九十百千]+'
/** ①「第N話／章／節／部／回／幕／夜／日」で始まる（副題が続いてもよい） */
const HEADING_DAI_RE = new RegExp(`^第${NUM}(?:話|章|節|部|回|幕|夜|日)(?=$|[\\s　：:．.・—－-])`)
/** ② 定型の見出し語で始まる */
const HEADING_WORD_RE =
  /^(?:プロローグ|エピローグ|序章|終章|幕間|間章|後日談|まえがき|あとがき)(?=$|[\s　：:])/
/** ③ 数字だけ、または数字＋区切り（. ． 、 : ：）か空白＋副題 */
const HEADING_NUM_RE = /^[0-9０-９]{1,4}(?:$|(?:[.．、:：][ 　]*|[ 　]+)\S)/
/** ④ Markdown 見出し（#〜###＋空白） */
const HEADING_MD_RE = /^#{1,3}[ 　]+\S/
/** ⑤ 【…】だけの行、■で始まる行 */
const HEADING_BRACKET_RE = /^(?:【[^】]{1,30}】|■.+)$/

/** 行が見出し行か。前後の空白を除いて 40 文字以内で、規則①〜⑤のいずれかに合う。 */
export function isHeadingLine(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > HEADING_MAX_LENGTH) return false
  return (
    HEADING_DAI_RE.test(t) ||
    HEADING_WORD_RE.test(t) ||
    HEADING_NUM_RE.test(t) ||
    HEADING_MD_RE.test(t) ||
    HEADING_BRACKET_RE.test(t)
  )
}

const SEPARATOR_RE = /^[-=ー―─━＊*※#＃]{3,}$/

/** 行が区切り行か。空白（半角・全角）を除いた残りが罫線記号だけで 3 文字以上。 */
export function isSeparatorLine(line: string): boolean {
  return SEPARATOR_RE.test(line.replace(/[\s　]+/g, ''))
}

/** ファイル名から拡張子を除いたもの（話や作品のタイトルの既定値に使う）。 */
export function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(0, i) : fileName
}

/** ファイル名の自然順（数字を数値として比較。`2.txt` < `10.txt`）。 */
export function sortSourcesNatural<T extends { name: string }>(sources: readonly T[]): T[] {
  return [...sources].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
}

/** 先頭・末尾の空行を落とす（行の中身や字下げは触らない）。 */
function trimBlankLines(lines: readonly string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === '') start++
  while (end > start && lines[end - 1]?.trim() === '') end--
  return lines.slice(start, end).join('\n')
}

interface Segment {
  title: string
  lines: string[]
  reason: SplitReason
  sourceLine: number
}

/** 1 ソースを見出し／区切りで分ける。見出しも区切りも無ければ 1 話（reason: 'file'）。 */
function splitSource(
  source: ImportSource,
  options: SplitOptions,
): { episodes: SplitEpisode[]; headingFound: boolean } {
  const lines = source.text.split('\n')
  const isPaste = source.name === ''
  const fallbackTitle = isPaste ? '' : baseName(source.name)
  const segments: Segment[] = []
  let current: Segment = { title: fallbackTitle, lines: [], reason: 'preamble', sourceLine: 0 }
  let headingFound = false
  let separatorFound = false

  const flush = () => {
    segments.push(current)
  }

  lines.forEach((line, index) => {
    if (isHeadingLine(line)) {
      headingFound = true
      flush()
      current = {
        title: line.trim(),
        lines: options.keepHeadingInBody ? [line] : [],
        reason: 'heading',
        sourceLine: index,
      }
      return
    }
    if (options.separators && isSeparatorLine(line)) {
      separatorFound = true
      flush()
      current = { title: '', lines: [], reason: 'separator', sourceLine: index }
      return
    }
    current.lines.push(line)
  })
  flush()

  if (!headingFound && !separatorFound) {
    return {
      episodes: [
        {
          title: fallbackTitle,
          body: trimBlankLines(lines),
          reason: 'file',
          sourceName: source.name,
          sourceLine: 0,
        },
      ],
      headingFound: false,
    }
  }

  const episodes: SplitEpisode[] = []
  for (const seg of segments) {
    const body = trimBlankLines(seg.lines)
    // 見出しの前にある本文は捨てずに 1 話として残す。空なら要らない。
    if (seg.reason === 'preamble' && body === '') continue
    // 区切り行で始まる区間が空（区切りが連続・末尾）なら要らない。
    if (seg.reason === 'separator' && body === '') continue
    episodes.push({
      title: seg.reason === 'preamble' && isPaste ? '序' : seg.title,
      body,
      reason: seg.reason,
      sourceName: source.name,
      sourceLine: seg.sourceLine,
    })
  }
  return { episodes, headingFound }
}

/**
 * 複数ソースを話に分ける。
 * - heading: ソースごとに見出し行で分け、結果を順に連ねる
 * - file: ソースごとに 1 話（タイトル＝ファイル名）
 * - none: 全ソースを連結して 1 話（タイトル＝作品タイトル）
 * 空タイトル（区切り行で分けた話・貼り付けで見出しが無いとき）は通し番号の「第N話」になる。
 */
export function splitEpisodes(
  sources: readonly ImportSource[],
  options: SplitOptions,
  workTitle: string,
): SplitResult {
  if (sources.length === 0) return { episodes: [], headingFound: false }

  if (options.mode === 'none') {
    const body = sources.map((s) => trimBlankLines(s.text.split('\n'))).join('\n\n')
    const first = sources[0] as ImportSource
    return {
      episodes: [
        { title: workTitle, body, reason: 'whole', sourceName: first.name, sourceLine: 0 },
      ],
      headingFound: false,
    }
  }

  if (options.mode === 'file') {
    return {
      episodes: sources.map((s) => ({
        title: baseName(s.name),
        body: trimBlankLines(s.text.split('\n')),
        reason: 'file',
        sourceName: s.name,
        sourceLine: 0,
      })),
      headingFound: false,
    }
  }

  const episodes: SplitEpisode[] = []
  let headingFound = false
  for (const s of sources) {
    const r = splitSource(s, options)
    headingFound ||= r.headingFound
    episodes.push(...r.episodes)
  }
  return { episodes: numberUntitled(episodes), headingFound }
}

/** 空タイトルを通し番号の「第N話」で埋める（N は全体での位置）。 */
export function numberUntitled(episodes: readonly SplitEpisode[]): SplitEpisode[] {
  return episodes.map((e, i) => (e.title === '' ? { ...e, title: `第${i + 1}話` } : e))
}

/** 手直しの安定キー：「元ファイル名＋開始行」。前後の話がつながっても他の手直しがずれない。 */
export type EpisodeKey = string

export function episodeKey(e: Pick<SplitEpisode, 'sourceName' | 'sourceLine'>): EpisodeKey {
  return `${e.sourceName}\u0000${e.sourceLine}`
}

export interface SplitEdits {
  /** キー → 利用者が入れたタイトル。 */
  titles: Record<EpisodeKey, string>
  /** 「前の話とつなげる」を押した話のキー。 */
  mergedInto: EpisodeKey[]
}

export const EMPTY_EDITS: SplitEdits = { titles: {}, mergedInto: [] }

/**
 * 分割結果に手直しを適用する（タイトル上書き → つなげる、の順）。
 * つなげた話の本文は前の話の末尾に空行を挟んで付く（見出しを本文に残す設定なら見出し行も本文に
 * 含まれているのでそのまま付く）。先頭の話はつなげる先が無いので無視する。
 */
export function applyEdits(
  episodes: readonly SplitEpisode[],
  edits: SplitEdits,
  _options: SplitOptions,
): SplitEpisode[] {
  const merged = new Set(edits.mergedInto)
  const out: SplitEpisode[] = []
  for (const e of episodes) {
    const key = episodeKey(e)
    const title = edits.titles[key] ?? e.title
    const prev = out[out.length - 1]
    if (merged.has(key) && prev) {
      prev.body = [prev.body, e.body].filter((b) => b !== '').join('\n\n')
      continue
    }
    out.push({ ...e, title })
  }
  return out
}
