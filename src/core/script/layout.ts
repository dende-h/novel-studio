import { plainTextOfBlock } from '../game'
import type { Block } from '../schema'
import { classifyScriptBlock } from './index'

/**
 * 脚本の原稿用紙レイアウト（既定 20字×20行・1枚400字）。
 *
 * 本文を「1マス1文字」の行に流し込み、枚数で数えられる形にする。プレビューと PDF は
 * ここが返す行と頁をそのまま描くだけで、判別や字下げの規則はこのファイルに閉じる。
 * 本文（Block）は書き換えない。字下げ・空行は打ってあっても打っていなくても同じ仕上がりに揃える。
 */

export interface SheetOptions {
  /** 1行の文字数（縦書きなら1列の字数）。 */
  cols: number
  /** 1頁の行数。 */
  rows: number
}

export const DEFAULT_SHEET: SheetOptions = { cols: 20, rows: 20 }

export type SheetLineKind =
  | 'blank'
  | 'slug'
  | 'direction'
  | 'dialogue'
  | 'transition'
  /** 話の題名など、本文の外側の見出し。 */
  | 'heading'
  /** 表紙の題名・著者名（頁の中央に置く）。 */
  | 'title'
  /** あらすじ・登場人物表など、字下げのない地の文。 */
  | 'text'
  /** ここで改頁する（行としては描かない）。 */
  | 'pageBreak'

export interface SheetLine {
  kind: SheetLineKind
  /** 1マス1文字。行頭の字下げは全角空白で含む。ぶら下げの句読点だけ cols を1文字超えることがある。 */
  text: string
}

export interface SheetPage {
  /** 本文の最初の頁を 1 とするノンブル。表紙・登場人物表・あらすじには振らない。 */
  number?: number
  lines: SheetLine[]
}

// --- 文字の扱い ------------------------------------------------------------

/** 行頭に置けない文字（追い出す）。句読点は別扱いでぶら下げる。 */
const NO_HEAD = new Set(
  Array.from(
    '）」』】〕〉》〙〗〟’”゛゜ヽヾゝゞ々〻ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ・：；？！',
  ),
)
/** 行末に置けない文字（次の行へ送る）。 */
const NO_TAIL = new Set(Array.from('（「『【〔〈《〘〖〝‘“'))
/** 行末からはみ出させてよい句読点（ぶら下げ）。 */
const HANG = new Set(Array.from('、。，．'))

/** 半角の英数記号と空白を全角へ。原稿用紙は1マス1文字なので半角が混ざると桝目が崩れる。 */
export function toFullWidth(text: string): string {
  return text
    .replace(/[!-~]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0))
    .replace(/ /gu, '　')
}

const chars = (text: string) => Array.from(text)

/**
 * 脚本の慣用に合わせて文字を整える：半角→全角、感嘆符・疑問符の後ろは1マス空ける
 * （閉じ括弧・空白・行末が続くときは空けない）。プレビューとテキスト書き出しで共用。
 */
export function normalizeScriptText(text: string): string {
  return toFullWidth(text).replace(/([！？]+)(?=[^！？　」』）〕】〉》\s])/gu, '$1　')
}

/**
 * 1段落を cols 幅の行に折り返す。firstIndent / restIndent は行頭の字下げ（マス数）。
 * 禁則は「行頭禁則の追い出し」「行末禁則の送り」「句読点のぶら下げ」の3つだけ。
 */
export function wrapLine(
  text: string,
  cols: number,
  firstIndent: number,
  restIndent: number,
): string[] {
  const cs = chars(text)
  const out: string[] = []
  let i = 0
  let first = true
  if (cs.length === 0) return ['　'.repeat(firstIndent)]
  while (i < cs.length) {
    const indent = first ? firstIndent : restIndent
    const width = Math.max(1, cols - indent)
    let end = Math.min(i + width, cs.length)
    if (end < cs.length) {
      // 次の行頭が句読点ならこの行末にぶら下げる。
      if (HANG.has(cs[end] as string)) {
        end += 1
      } else {
        // 行頭禁則の文字と、行末禁則の文字は前へ追い出す（詰まりすぎない範囲で）。
        let e = end
        while (e > i + 1 && (NO_HEAD.has(cs[e] as string) || NO_TAIL.has(cs[e - 1] as string))) {
          e -= 1
        }
        if (e > i) end = e
      }
    }
    out.push('　'.repeat(indent) + cs.slice(i, end).join(''))
    i = end
    first = false
  }
  return out
}

// --- 本文の流し込み ----------------------------------------------------------

/** 場面転換の記号。時間経過・場面の切り替えを表す慣用表記。 */
const TRANSITION_MARK = '×　　×　　×'

function centered(text: string, cols: number): string {
  const pad = Math.max(0, Math.floor((cols - chars(text).length) / 2))
  return '　'.repeat(pad) + text
}

function pushBlank(lines: SheetLine[]) {
  const last = lines[lines.length - 1]
  if (!last || last.kind === 'blank' || last.kind === 'pageBreak') return
  lines.push({ kind: 'blank', text: '' })
}

/**
 * 本文ブロックを行に流し込む。
 * - 柱：行頭。前に空行を1つ置く（打ってあっても増やさない）。
 * - ト書き：3字下げ。折り返しも3字下げ。行頭の空白は打ってあってもなくても同じ。
 * - セリフ：話者名を行頭に置き、2行目以降は1字下げ。
 * - 場面転換：×　　×　　× を中央に。前後に空行。
 * - 空行：連続しても1つに畳む。
 */
export function layoutScriptBlocks(
  blocks: Block[],
  opts: SheetOptions = DEFAULT_SHEET,
): SheetLine[] {
  const lines: SheetLine[] = []
  for (const block of blocks) {
    const line = classifyScriptBlock(block)
    const raw = plainTextOfBlock(block)
    const text = normalizeScriptText(raw.replace(/^\s+/u, '').replace(/\s+$/u, ''))
    switch (line.kind) {
      case 'blank':
        pushBlank(lines)
        break
      case 'slug':
        pushBlank(lines)
        for (const t of wrapLine(text, opts.cols, 0, 1)) lines.push({ kind: 'slug', text: t })
        break
      case 'transition':
        pushBlank(lines)
        lines.push({ kind: 'transition', text: centered(TRANSITION_MARK, opts.cols) })
        pushBlank(lines)
        break
      case 'dialogue':
        for (const t of wrapLine(text, opts.cols, 0, 1)) lines.push({ kind: 'dialogue', text: t })
        break
      default:
        for (const t of wrapLine(text, opts.cols, 3, 3)) lines.push({ kind: 'direction', text: t })
    }
  }
  return lines
}

// --- 頁割り --------------------------------------------------------------------

/**
 * 行を rows ごとに頁へ切る。
 * - 頁の先頭に空行は置かない。
 * - 柱が頁の最終行に来るときは次の頁へ送る（柱だけ取り残さない）。
 * - pageBreak で強制改頁。
 * - ノンブルは本文の最初の頁を 1 とする（`numberFrom` 以降の行が本文）。
 */
export function paginate(
  lines: SheetLine[],
  opts: SheetOptions = DEFAULT_SHEET,
  numberFrom = 0,
): SheetPage[] {
  const pages: SheetPage[] = []
  let current: SheetLine[] = []
  let consumed = 0
  let numbered = 0
  const flush = () => {
    if (current.length === 0) return
    const isBody = consumed > numberFrom
    pages.push(isBody ? { number: ++numbered, lines: current } : { lines: current })
    current = []
  }
  for (const line of lines) {
    consumed += 1
    if (line.kind === 'pageBreak') {
      flush()
      continue
    }
    if (line.kind === 'blank' && current.length === 0) continue
    if (current.length >= opts.rows) flush()
    if (line.kind === 'slug' && current.length === opts.rows - 1) {
      // 直前の空行ごと次頁へ送る。
      const prev = current[current.length - 1]
      if (prev?.kind === 'blank') current.pop()
      flush()
    }
    if (line.kind === 'blank' && current.length === 0) continue
    current.push(line)
  }
  flush()
  return pages
}

// --- 提出用の綴じ方（表紙・登場人物・あらすじ・本編） ------------------------------------

export interface SheetSource {
  title: string
  /** 著者名。空なら表紙に載せない。 */
  author?: string
  /** 登場人物表（用語集の人物：名前と説明）。空なら頁を作らない。 */
  cast?: { name: string; note?: string }[]
  /** 梗概（結末まで書く提出用のあらすじ）。空なら頁を作らない。 */
  synopsis?: string
  /** 本編。話が複数なら話ごとに改頁し、題名を見出しに置く。 */
  episodes: { title: string; blocks: Block[] }[]
}

export interface SheetFrontMatter {
  cover: boolean
  cast: boolean
  synopsis: boolean
}

export const DEFAULT_FRONT_MATTER: SheetFrontMatter = { cover: true, cast: true, synopsis: true }

/** 頁の中央に置く行（表紙用）。上下の余白を空行で作る。 */
function titlePage(source: SheetSource, opts: SheetOptions): SheetLine[] {
  const body: SheetLine[] = []
  const title = normalizeScriptText(source.title.trim() || '無題')
  for (const t of wrapLine(title, opts.cols, 0, 0))
    body.push({ kind: 'title', text: centered(t, opts.cols) })
  if (source.author?.trim()) {
    body.push({ kind: 'blank', text: '' })
    body.push({
      kind: 'title',
      text: centered(normalizeScriptText(source.author.trim()), opts.cols),
    })
  }
  const top = Math.max(0, Math.floor((opts.rows - body.length) / 2))
  const lines: SheetLine[] = []
  for (let i = 0; i < top; i++) lines.push({ kind: 'blank', text: '' })
  lines.push(...body, { kind: 'pageBreak', text: '' })
  return lines
}

function castPage(cast: NonNullable<SheetSource['cast']>, opts: SheetOptions): SheetLine[] {
  const lines: SheetLine[] = [
    { kind: 'heading', text: '登場人物表' },
    { kind: 'blank', text: '' },
  ]
  for (const c of cast) {
    const name = normalizeScriptText(c.name.trim())
    const note = c.note?.trim() ? normalizeScriptText(c.note.replace(/\s+/gu, ' ').trim()) : ''
    const nameWidth = chars(name).length
    if (!note) {
      lines.push({ kind: 'text', text: name })
      continue
    }
    // 名前の後に1マス空けて説明。折り返しは説明の頭に揃える。
    const hang = Math.min(nameWidth + 1, Math.floor(opts.cols / 2))
    for (const t of wrapLine(`${name}　${note}`, opts.cols, 0, hang))
      lines.push({ kind: 'text', text: t })
  }
  lines.push({ kind: 'pageBreak', text: '' })
  return lines
}

function synopsisPage(synopsis: string, opts: SheetOptions): SheetLine[] {
  const lines: SheetLine[] = [
    { kind: 'heading', text: 'あらすじ' },
    { kind: 'blank', text: '' },
  ]
  for (const para of synopsis.replace(/\r\n?/gu, '\n').split('\n')) {
    const text = normalizeScriptText(para.trim())
    if (!text) {
      pushBlank(lines)
      continue
    }
    for (const t of wrapLine(text, opts.cols, 1, 0)) lines.push({ kind: 'text', text: t })
  }
  lines.push({ kind: 'pageBreak', text: '' })
  return lines
}

/**
 * 提出用の頁一式を組む。表紙 → 登場人物表 → 梗概 → 本文（話ごとに改頁）。
 * ノンブルは本文の最初の頁を 1 とし、前付けには振らない。
 */
export function composeScriptSheet(
  source: SheetSource,
  front: SheetFrontMatter = DEFAULT_FRONT_MATTER,
  opts: SheetOptions = DEFAULT_SHEET,
): SheetPage[] {
  const lines: SheetLine[] = []
  if (front.cover) lines.push(...titlePage(source, opts))
  if (front.cast && source.cast && source.cast.length > 0)
    lines.push(...castPage(source.cast, opts))
  if (front.synopsis && source.synopsis?.trim()) lines.push(...synopsisPage(source.synopsis, opts))
  const frontLength = lines.length
  const multi = source.episodes.length > 1
  source.episodes.forEach((ep, i) => {
    if (i > 0) lines.push({ kind: 'pageBreak', text: '' })
    if (multi || ep.title.trim()) {
      for (const t of wrapLine(
        normalizeScriptText(ep.title.trim() || `第${i + 1}話`),
        opts.cols,
        0,
        1,
      )) {
        lines.push({ kind: 'heading', text: t })
      }
      lines.push({ kind: 'blank', text: '' })
    }
    lines.push(...layoutScriptBlocks(ep.blocks, opts))
  })
  return paginate(lines, opts, frontLength)
}

/** 本編だけの枚数（表紙などを除く）。ステータス表示用。 */
export function countScriptSheets(blocks: Block[], opts: SheetOptions = DEFAULT_SHEET): number {
  return paginate(layoutScriptBlocks(blocks, opts), opts).length
}
