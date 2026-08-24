import { inlinesToHtml } from '../exporter/toHtml'
import { parseInlines } from '../parser/parseNotation'

/**
 * 記法つき入力欄（プロットの要約・メモ、世界観設定、用語集の公開情報・作者メモ）の
 * プレビュー用の軽量マークダウン。行単位で解釈し、行の中身は本文と同じ記法
 * （[[用語]]・ルビ・傍点）を parseInlines へ委譲するので、参照リンク等はそのまま生きる。
 *
 * 対応する記法：
 * - `**強調**`（太字）
 * - `# 見出し` `## 見出し` `### 見出し`（3 段まで。4 個以上の # は解釈しない）
 * - `- 箇条書き` / `1. 番号付き`（字下げで 3 階層まで。スペース 2 つ＝タブ＝全角空白 1 つが 1 段）
 * - `| 列 | 列 |` の表（行を | で始めて | で終える。2 行目が `| --- |` なら 1 行目が見出し）
 * - `---`（区切り線）
 * - `> 引用`
 *
 * **本文（エピソード）には適用しない。** 正本 block スキーマは変えず、ここは
 * 「保存済みの生テキスト → 表示 HTML」の一方通行なので、保存データは過去の全バージョンと
 * 同じただの文字列のまま＝後方互換に影響しない。出力はすべて parseInlines → inlinesToHtml
 * 経由でエスケープされる（構造を作る記号だけをここで消費し、生の HTML は一切通さない）。
 */

const HR_RE = /^\s*-{3,}\s*$/
const HEADING_RE = /^(#{1,3})[ \t　]+(.*)$/
// marker 直後の空白は必須（`-foo` や `1.5倍` を巻き込まない）。
const LIST_RE = /^([ \t　]*)(?:([-*+])|(\d{1,3})[.)])[ \t　]+(.*)$/
const QUOTE_RE = /^\s*>/
const QUOTE_STRIP_RE = /^\s*(?:> ?)/
const SEP_CELL_RE = /^:?-+:?$/

/**
 * 表の行とみなす条件は「| で始まり | で終わる」。GFM より狭いが、行頭の半角 | は
 * ルビ記法（|親文字《よみ》）と衝突するため、末尾の | まで要求して誤爆を避ける。
 */
function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.length >= 2 && t.startsWith('|') && t.endsWith('|')
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEP_CELL_RE.test(c))
}

function alignOf(cell: string): '' | 'center' | 'right' {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return ''
}

/** 字下げ幅 → リスト階層（0〜2）。スペース=1、タブ・全角空白=2 として 2 幅で 1 段。 */
function indentLevel(ws: string): number {
  let width = 0
  for (const ch of ws) width += ch === ' ' ? 1 : 2
  return Math.min(2, Math.floor(width / 2))
}

/**
 * 1 行ぶんのインライン描画。`**強調**` の対だけをここで消費し、残りは本文と同じ
 * parseInlines に任せる（[[用語]]・ルビ・傍点は強調の内側でも解釈される）。
 * 対にならない ** はただの文字として残す。
 */
function inlineHtml(text: string, resolvedNames?: Set<string>): string {
  let html = ''
  let plain = ''
  const flush = () => {
    if (plain !== '') {
      html += inlinesToHtml(parseInlines(plain), resolvedNames)
      plain = ''
    }
  }
  let i = 0
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        html += `<strong>${inlinesToHtml(parseInlines(text.slice(i + 2, end)), resolvedNames)}</strong>`
        i = end + 2
        continue
      }
    }
    plain += text[i]
    i++
  }
  flush()
  return html
}

interface ListItem {
  level: number
  ordered: boolean
  number: number
  text: string
}

/**
 * 同階層・同種の連続を 1 つの <ul>/<ol> にまとめ、深い項目は直前の <li> の中へ入れる
 * （HTML として妥当な入れ子）。同階層で種類が変わったら列を閉じて開き直す。
 */
function renderListAt(
  items: ListItem[],
  pos: { i: number },
  level: number,
  resolvedNames?: Set<string>,
): string {
  const first = items[pos.i] as ListItem
  const ordered = first.ordered
  let html = ordered ? (first.number !== 1 ? `<ol start="${first.number}">` : '<ol>') : '<ul>'
  while (pos.i < items.length) {
    const item = items[pos.i] as ListItem
    if (item.level < level) break
    if (item.level === level && item.ordered !== ordered) break
    if (item.level > level) {
      const child = renderListAt(items, pos, level + 1, resolvedNames)
      html = html.endsWith('</li>')
        ? `${html.slice(0, -'</li>'.length)}${child}</li>`
        : `${html}<li>${child}</li>`
      continue
    }
    html += `<li>${inlineHtml(item.text, resolvedNames)}</li>`
    pos.i++
  }
  return html + (ordered ? '</ol>' : '</ul>')
}

function renderTable(rows: string[][], resolvedNames?: Set<string>): string {
  const hasHeader = rows.length >= 2 && isSeparatorRow(rows[1] as string[])
  const aligns = hasHeader ? (rows[1] as string[]).map(alignOf) : []
  const bodyRows = hasHeader ? rows.slice(2) : rows
  const rowHtml = (tag: 'th' | 'td', cells: string[]) =>
    `<tr>${cells
      .map((c, idx) => {
        const a = aligns[idx]
        // align は固定 3 値からしか作らないので属性値として安全。
        const style = a ? ` style="text-align:${a}"` : ''
        return `<${tag}${style}>${inlineHtml(c, resolvedNames)}</${tag}>`
      })
      .join('')}</tr>`
  const head = hasHeader ? `<thead>${rowHtml('th', rows[0] as string[])}</thead>` : ''
  const body =
    bodyRows.length > 0 ? `<tbody>${bodyRows.map((r) => rowHtml('td', r)).join('')}</tbody>` : ''
  // 横に長い表はパネル内で自分だけ横スクロールさせる（包みは CSS の .md-table が持つ）。
  return `<div class="md-table"><table>${head}${body}</table></div>`
}

function renderBlocks(
  lines: string[],
  resolvedNames: Set<string> | undefined,
  depth: number,
): string {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] as string

    if (HR_RE.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    const h = HEADING_RE.exec(line)
    if (h) {
      const level = (h[1] as string).length
      out.push(`<h${level}>${inlineHtml(h[2] ?? '', resolvedNames)}</h${level}>`)
      i++
      continue
    }

    // 引用は連続行をまとめ、> を剥いだ中身を再帰で解釈する（引用の中でも見出し・リストが使える）。
    if (QUOTE_RE.test(line) && depth < 4) {
      const inner: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i] as string)) {
        inner.push((lines[i] as string).replace(QUOTE_STRIP_RE, ''))
        i++
      }
      out.push(`<blockquote>${renderBlocks(inner, resolvedNames, depth + 1)}</blockquote>`)
      continue
    }

    if (LIST_RE.test(line)) {
      const items: ListItem[] = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i] as string)
        if (!m) break
        items.push({
          level: indentLevel(m[1] ?? ''),
          ordered: m[2] === undefined,
          number: m[3] !== undefined ? Number.parseInt(m[3], 10) : 1,
          text: m[4] ?? '',
        })
        i++
      }
      const pos = { i: 0 }
      let html = ''
      while (pos.i < items.length) {
        html += renderListAt(items, pos, (items[pos.i] as ListItem).level, resolvedNames)
      }
      out.push(html)
      continue
    }

    // 表は 2 行以上の連続が条件（単独行はルビ記法かもしれないので段落へ倒す）。
    if (isTableRow(line) && i + 1 < lines.length && isTableRow(lines[i + 1] as string)) {
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i] as string)) {
        rows.push(splitRow(lines[i] as string))
        i++
      }
      out.push(renderTable(rows, resolvedNames))
      continue
    }

    // ここから下は従来の NotationField プレビューと同じ（1 行 = 1 段落・空行も保持）。
    if (line.trim() === '') {
      out.push('<p class="blank"></p>')
      i++
      continue
    }
    out.push(`<p>${inlineHtml(line, resolvedNames)}</p>`)
    i++
  }
  return out.join('')
}

/**
 * 生テキスト → プレビュー HTML。resolvedNames の意味は blocksToHtml と同じ
 * （指定あり＝ [[用語]] をリンク描画、未指定＝プレーンへ degrade）。
 */
export function markdownToHtml(text: string, resolvedNames?: Set<string>): string {
  return renderBlocks(text.split('\n'), resolvedNames, 0)
}

const BOLD_PAIR_RE = /\*\*([^*]+?)\*\*/g

/**
 * マークダウンの記号だけを剥がした表示用テキスト（カードの要約 1 行など「読むだけ」の場所用）。
 * [[用語]]・ルビ・傍点はそのまま残す＝呼び出し側が従来どおり blocksToPlainText で剥がす。
 */
export function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (HR_RE.test(line)) return ''
      const h = HEADING_RE.exec(line)
      if (h) return (h[2] ?? '').replace(BOLD_PAIR_RE, '$1')
      const li = LIST_RE.exec(line)
      if (li) return `${li[1] ?? ''}${(li[4] ?? '').replace(BOLD_PAIR_RE, '$1')}`
      if (isTableRow(line)) {
        const cells = splitRow(line)
        if (isSeparatorRow(cells)) return ''
        return cells.map((c) => c.replace(BOLD_PAIR_RE, '$1')).join(' ')
      }
      return line.replace(/^\s*(?:> ?)+/, '').replace(BOLD_PAIR_RE, '$1')
    })
    .join('\n')
}
