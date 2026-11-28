import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fileTitle, type ManuscriptSource } from '@/core/importer/site-formats'
import { MAX_IMPORT_BYTES, textBytes } from '@/core/importer/text'
import { illustrationFileTag } from '@/core/sites/illustrations'
import { abortable, readManuscriptFile } from './manuscript-file'

const cmaps = import.meta.glob('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

class LocalPdfResources {
  constructor(private readonly signal: AbortSignal) {}

  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const url = kind === 'cMapUrl' && cmaps[`../../../node_modules/pdfjs-dist/cmaps/${filename}`]
    if (!url || !/^[\w.-]+\.bcmap$/.test(filename)) throw new Error('PDFの文字マップがありません')
    const response = await fetch(url, { signal: this.signal })
    if (!response.ok) throw new Error('PDFの文字マップを読み込めません')
    return new Uint8Array(await response.arrayBuffer())
  }
}

async function bookmarks(pdf: PDFDocumentProxy, signal: AbortSignal) {
  const outline = await abortable(signal, () => pdf.getOutline())
  const entries = new Map<number, { number: number; title: string; depth: number }>()
  const pending = (outline ?? []).map((item) => ({ item, depth: 0 })).reverse()
  while (pending.length) {
    signal.throwIfAborted()
    const current = pending.pop()
    if (!current) break
    const { item, depth } = current
    for (const child of [...item.items].reverse()) pending.push({ item: child, depth: depth + 1 })
    try {
      const dest =
        typeof item.dest === 'string'
          ? await abortable(signal, () => pdf.getDestination(item.dest as string))
          : item.dest
      if (!dest?.length || !item.title.trim()) continue
      const index =
        typeof dest[0] === 'number'
          ? dest[0]
          : await abortable(signal, () => pdf.getPageIndex(dest[0]))
      if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) continue
      const number = index + 1
      const previous = entries.get(number)
      // Prefer an episode bookmark over a parent chapter pointing to the same page.
      if (!previous || depth > previous.depth)
        entries.set(number, { number, title: item.title, depth })
    } catch {
      signal.throwIfAborted()
    }
  }
  return [...entries.values()].sort((a, b) => a.number - b.number)
}

type Glyph = { text: string; x: number; y: number; size: number; end: boolean; vertical: boolean }

function uprightColumns(items: Glyph[]): Glyph[] {
  // Some vertical PDFs position upright glyphs individually without a vertical font.
  // Require descending runs in multiple columns so normal horizontal paragraphs stay intact.
  const columns = new Map<number, { items: Glyph[]; linked: number }>()
  let previous: Glyph | undefined
  for (const item of items) {
    const key = Math.round(item.x)
    const column = columns.get(key) ?? { items: [], linked: 0 }
    column.items.push(item)
    if (
      previous &&
      previous.y > item.y &&
      Math.abs(previous.x - item.x) < 1 &&
      previous.y - item.y <= item.size * 2.5 &&
      [...item.text].length <= 2
    ) {
      column.linked += 1
    }
    columns.set(key, column)
    previous = item
  }
  const candidates = [...columns.values()].filter(
    ({ linked, items }) => linked >= 4 && linked >= items.length * 0.5,
  )
  const glyphs = candidates.flatMap(({ items }) => items)
  if (candidates.length < 2 || glyphs.length < items.length * 0.6) return []

  const positions = candidates.map(({ items }) => items[0]?.x ?? 0).sort((a, b) => a - b)
  const distances = positions
    .slice(1)
    .map((x, i) => x - (positions[i] ?? x))
    .sort((a, b) => a - b)
  const columnStep = distances[Math.floor(distances.length / 2)] ?? 0
  const left = positions[0] ?? 0
  const right = positions.at(-1) ?? 0
  const baseSize = glyphs[0]?.size ?? 1
  const top = glyphs.reduce((maximum, item) => Math.max(maximum, item.y), 0)
  const bottom = glyphs.reduce((minimum, item) => Math.min(minimum, item.y), top)
  const selected = new Set(glyphs)
  for (const item of items) {
    // A wrapped column may contain only a few characters, including a final punctuation mark.
    if (
      item.x >= left - columnStep - 1 &&
      item.x <= right + 1 &&
      item.y >= bottom - baseSize &&
      item.y <= top + 1 &&
      Math.abs(item.size - baseSize) < baseSize * 0.2 &&
      [...item.text].length <= 2
    )
      selected.add(item)
  }
  return [...selected]
}

async function extractPage(pdf: PDFDocumentProxy, number: number, signal: AbortSignal) {
  // Destroying the loading task also stops a pending getPage. If the page was
  // already obtained, release it even when getTextContent fails or is cancelled.
  const page = await pdf.getPage(number)
  try {
    const content = await abortable(signal, () =>
      page.getTextContent({ disableNormalization: true }),
    )
    return extractText(content)
  } finally {
    page.cleanup()
  }
}

function extractText(content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>) {
  const items: Glyph[] = content.items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return []
    const [a, b, , , x, y] = item.transform
    return [
      {
        text: item.str,
        x: x ?? 0,
        y: y ?? 0,
        size: Math.max(1, Math.hypot(a ?? 0, b ?? 0)),
        end: item.hasEOL,
        vertical:
          Boolean(content.styles[item.fontName]?.vertical) || Math.abs(b ?? 0) > Math.abs(a ?? 0),
      },
    ]
  })
  if (!items.length) return { text: '', vertical: false, review: false }
  const upright = uprightColumns(items)
  const glyphs = upright.length ? upright : items.filter((item) => item.vertical)
  const vertical = glyphs.length > 0
  let lines: string[]
  let review = false
  if (vertical) {
    const columns: { x: number; letters: typeof items }[] = []
    const orderedSizes = glyphs.map((item) => item.size).sort((a, b) => a - b)
    const normalSize = orderedSizes[Math.floor(orderedSizes.length / 2)] ?? 1
    review = glyphs.some((item) => item.size < normalSize * 0.8)
    for (const item of glyphs.sort((a, b) => b.x - a.x || b.y - a.y)) {
      const column = columns.at(-1)
      if (column && Math.abs(item.x - column.x) < normalSize * 0.32) column.letters.push(item)
      else columns.push({ x: item.x, letters: [item] })
    }
    for (const { letters } of columns) letters.sort((a, b) => b.y - a.y)
    lines = columns.map(({ letters }) => letters.map((item) => item.text).join(''))
    if (upright.length) {
      const tops = columns.map(({ letters }) => letters[0]?.y ?? 0)
      const top = tops.reduce((maximum, y) => Math.max(maximum, y), 0)
      const gaps = columns
        .flatMap(({ letters }) =>
          letters.slice(1).map((item, i) => (letters[i]?.y ?? item.y) - item.y),
        )
        .filter((gap) => gap > 0)
        .sort((a, b) => a - b)
      const rowHeight = gaps[Math.floor(gaps.length / 2)] ?? normalSize
      const linesWithGaps: string[] = []
      for (const [index, line] of lines.entries()) {
        const rows = Math.max(0, Math.round((top - (tops[index] ?? top)) / rowHeight))
        if (rows === 0 && linesWithGaps.length) {
          const previous = linesWithGaps.pop()
          linesWithGaps.push((previous ?? '') + line)
        } else linesWithGaps.push('\n'.repeat(Math.min(5, Math.max(0, rows - 1))) + line)
      }
      lines = linesWithGaps
    }
    // 横書きの見出し・柱・ページ番号もプレビューに表示する。
    const verticalItems = new Set(glyphs)
    const horizontal = items.filter((item) => !verticalItems.has(item))
    const top = glyphs.reduce((maximum, item) => Math.max(maximum, item.y), 0)
    const headings = horizontal.filter((item) => item.y > top)
    const footers = horizontal.filter((item) => item.y <= top)
    lines = [...headings.map((item) => item.text), ...lines, ...footers.map((item) => item.text)]
    review ||= horizontal.length > 0
  } else {
    const rows: { y: number; text: string; end: boolean }[] = []
    for (const item of items) {
      const row = rows.at(-1)
      if (row && !row.end && Math.abs(row.y - item.y) < item.size * 0.4) {
        row.text += item.text
        row.end = item.end
      } else rows.push({ y: item.y, text: item.text, end: item.end })
    }
    lines = rows.map((row) => row.text)
    review = rows.some((row, i) => i > 0 && row.y > rows[i - 1]!.y + 25)
  }
  return {
    text: lines
      .map((line) =>
        /^\s*[A-Za-z0-9_-]{4,}\.(?:jpeg|jpg|png|gif|webp)\s*$/i.test(line)
          ? illustrationFileTag(line.trim())
          : line,
      )
      .join('\n'),
    vertical,
    review,
  }
}

export async function readManuscriptPdf(
  file: File,
  signal: AbortSignal,
  path = file.name,
): Promise<ManuscriptSource> {
  signal.throwIfAborted()
  if (file.size > MAX_IMPORT_BYTES) throw new Error('PDFは20 MBまで取り込めます')
  const data = await readManuscriptFile(file, signal)
  signal.throwIfAborted()
  if (!new TextDecoder().decode(data.subarray(0, 8)).startsWith('%PDF-'))
    throw new Error('ファイルの中身がPDF形式と一致しません')
  const password = new AbortController()
  const extraction = AbortSignal.any([signal, password.signal])
  class Resources extends LocalPdfResources {
    constructor() {
      super(extraction)
    }
  }
  GlobalWorkerOptions.workerSrc = workerUrl
  const task = getDocument({
    data,
    BinaryDataFactory: Resources,
    cMapUrl: '/assets/',
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  })
  let destroying: Promise<void> | undefined
  const destroy = () => {
    destroying ??= task.destroy().catch(() => {})
    return destroying
  }
  const cancel = () => {
    void destroy()
  }
  extraction.addEventListener('abort', cancel, { once: true })
  task.onPassword = () => {
    password.abort(
      new Error('パスワード付きのPDFは取り込めません。パスワードを解除したPDFを選んでください'),
    )
  }
  try {
    const pdf = await abortable(extraction, () => task.promise)
    if (pdf.numPages > 1000) throw new Error('PDFは1,000ページまで取り込めます')
    const meta = (await abortable(extraction, () => pdf.getMetadata())).info as {
      Title?: unknown
      Author?: unknown
    }
    const title =
      typeof meta.Title === 'string' && meta.Title.trim() && meta.Title !== 'untitled'
        ? meta.Title
        : fileTitle(file.name)
    const author =
      typeof meta.Author === 'string' && meta.Author !== 'anonymous' ? meta.Author : undefined
    const outline = await bookmarks(pdf, extraction).catch(() => {
      extraction.throwIfAborted()
      return []
    })
    const episodes: ManuscriptSource['episodes'] = []
    const warnings: string[] = []
    let bytes = 0
    let firstPage = 1
    for (let number = 1; number <= pdf.numPages; number++) {
      const entry = outline.find((item) => item.number === number)
      const page = await abortable(extraction, () => extractPage(pdf, number, extraction))
      if (page.vertical || page.review || !page.text) {
        warnings.push(
          number +
            'ページを元のPDFと照らし合わせてください。' +
            (page.vertical ? ' 縦書きは右の列から並べました。' : '') +
            (page.review ? ' 見出し・段組・ルビの位置を確認してください。' : '') +
            (!page.text ? ' 読み取れる文字がありません。' : ''),
        )
      }
      if (number === 1 || entry) {
        if (episodes.length) episodes.at(-1)!.pages = `${firstPage}–${number - 1}`
        episodes.push({ title: entry?.title ?? title, body: '', path })
        firstPage = number
      }
      const episode = episodes.at(-1)!
      if (number === 1 && !entry && outline.length) {
        episode.title = '冒頭（表紙・作品情報など）'
        episode.frontMatter = true
      }
      if (episode.body && page.text) episode.body += '\n\n'
      episode.body += page.text
      bytes += textBytes(page.text) + 2
      if (bytes > MAX_IMPORT_BYTES) throw new Error('抽出した本文が20 MBを超えています')
    }
    if (episodes.length) episodes.at(-1)!.pages = `${firstPage}–${pdf.numPages}`
    if (!episodes.some((episode) => episode.body.trim())) {
      throw new Error(
        'PDFに読み取れる文字がありません。TXTを選ぶか、元の編集画面から本文をコピーして貼り付けてください',
      )
    }
    return {
      name: path,
      title,
      author,
      episodes: episodes.filter((episode) => episode.body.trim()),
      warnings: [
        'PDFの文字層を読み取りました。保存前にプレビューと元のページを見比べてください。文字や順序が崩れる場合は、TXTまたは貼り付けで取り込んでください。',
        ...warnings,
      ],
      expandedBytes: bytes,
      structured: Boolean(outline.length),
    }
  } finally {
    extraction.removeEventListener('abort', cancel)
    await destroy()
  }
}
