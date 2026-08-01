import type { Block, Inline, RefChild } from '../schema'

/**
 * なろう/カクヨム互換の記法 → 正本 block 列。
 * - 改行 = 1 block（空行も空paragraphで保持）
 * - ルビ: ｜親文字《よみ》（半角| 可、漢字親文字はパイプ省略可）
 * - 傍点: 《《テキスト》》
 * - @参照: [[名前]]
 *
 * 参照はルビ・傍点と重ねられる（`[[｜言葉《ことば》]]` / `[[《《言葉》》]]`）。
 * 重ねは **ref を外側** に持つ形へ正規化する（`《《[[言葉]]》》` や `｜[[言葉]]《ことば》`
 * と書いても同じ ref+装飾になる）。装飾は ref.children に載り、リンクの解決に使う
 * ref.name は装飾を剥いだプレーン文字列（ルビなら親文字）を入れる。
 * 純関数（テストの主戦場）。
 */

// 自動ルビ（パイプ省略）の親文字に許す漢字レンジ
const KANJI = '\\u4E00-\\u9FFF\\u3005\\u3006\\u30F5\\u30F6'
const AUTO_RUBY_RE = new RegExp(`^([${KANJI}]+)《([^》]+)》`)
const ALL_KANJI_RE = new RegExp(`^[${KANJI}]+$`)

/**
 * ルビを書くときに親文字の前へ `｜` が必要か。
 * 親文字が漢字だけなら自動ルビ（`漢字《よみ》`）が効くのでパイプは不要、
 * かな・英数字・記号が混じるなら `｜親文字《よみ》` と明示する必要がある。
 *
 * 記法を組み立てる UI（挿入ボタン）が判定を複製するとパーサとズレて壊れるため、
 * 上の KANJI 定数を共有するかたちでここに置く。
 */
export function needsRubyPipe(base: string): boolean {
  return base === '' || !ALL_KANJI_RE.test(base)
}

export function parseEpisodeBody(text: string): Block[] {
  return text.split('\n').map(
    (line, i): Block => ({
      id: `b${i + 1}`,
      type: 'paragraph',
      inlines: parseInlines(line),
    }),
  )
}

/**
 * ref の解決名・文字数に使うプレーン文字列（ルビは親文字、傍点は本文）。
 * ref.name はこれと一致させる規約なので、集計・解決側は name をそのまま見てよい。
 */
export function refPlainText(children: RefChild[]): string {
  return children.map((c) => (c.type === 'ruby' ? c.base : c.text)).join('')
}

/** ref の中身に置ける装飾（ルビ・傍点）だけを解釈する。ref は解釈しない＝重ねは 1 段まで。 */
function parseRefChildren(inner: string): RefChild[] {
  return scanInlines(inner, false) as RefChild[]
}

/** children から ref inline を組む（name は装飾を剥いだプレーン文字列）。 */
function refOf(children: RefChild[]): Inline {
  return { type: 'ref', name: refPlainText(children).trim(), children }
}

/**
 * `[[名前]]` ちょうど 1 個ならその中身を返す（装飾で ref を囲んだ形の検出）。
 * 囲みが部分的（`《《前[[名前]]後》》`）なら対応が決められないので null＝非解釈に倒す。
 */
function soleRefInner(s: string): string | null {
  if (s.length < 4 || !s.startsWith('[[') || !s.endsWith(']]')) return null
  const inner = s.slice(2, -2)
  return inner.includes('[[') || inner.includes(']]') ? null : inner
}

export function parseInlines(line: string): Inline[] {
  return scanInlines(line, true)
}

function scanInlines(line: string, allowRef: boolean): Inline[] {
  const inlines: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) {
      inlines.push({ type: 'text', text: buf })
      buf = ''
    }
  }

  let i = 0
  while (i < line.length) {
    // @参照: [[名前]]（P1）。区切りは ]] または行末。前後 trim（半角/全角空白）。
    // 中身の存在に関わらず常に ref（未終端・空も ref 化）。中身はルビ・傍点だけ解釈する。
    if (allowRef && line.startsWith('[[', i)) {
      const end = line.indexOf(']]', i + 2)
      const inner = (end === -1 ? line.slice(i + 2) : line.slice(i + 2, end)).trim()
      const children = parseRefChildren(inner)
      flush()
      // 装飾が無い ref は children を持たせない（従来データと同形＝差分を作らない）。
      inlines.push(
        children.every((c) => c.type === 'text') ? { type: 'ref', name: inner } : refOf(children),
      )
      i = end === -1 ? line.length : end + 2
      continue
    }

    // 傍点: 《《 ... 》》
    if (line.startsWith('《《', i)) {
      const end = line.indexOf('》》', i + 2)
      if (end !== -1) {
        const inner = line.slice(i + 2, end)
        // 傍点で ref を囲んだ形（《《[[言葉]]》》）は ref を外側へ持ち上げて正規化する。
        const refInner = allowRef ? soleRefInner(inner) : null
        flush()
        inlines.push(
          refInner === null
            ? { type: 'emphasisDots', text: inner }
            : refOf([
                { type: 'emphasisDots', text: refPlainText(parseRefChildren(refInner.trim())) },
              ]),
        )
        i = end + 2
        continue
      }
    }

    // 明示ルビ: ｜base《reading》 / |base《reading》
    if (line[i] === '｜' || line[i] === '|') {
      const open = line.indexOf('《', i + 1)
      const close = open === -1 ? -1 : line.indexOf('》', open + 1)
      if (open !== -1 && close !== -1) {
        const base = line.slice(i + 1, open)
        const reading = line.slice(open + 1, close)
        // ルビで ref を囲んだ形（｜[[言葉]]《ことば》）も ref を外側へ持ち上げる。
        const refInner = allowRef ? soleRefInner(base) : null
        flush()
        inlines.push(
          refInner === null
            ? { type: 'ruby', base, reading }
            : refOf([
                { type: 'ruby', base: refPlainText(parseRefChildren(refInner.trim())), reading },
              ]),
        )
        i = close + 1
        continue
      }
    }

    // 自動ルビ: <漢字列>《reading》
    const auto = AUTO_RUBY_RE.exec(line.slice(i))
    if (auto) {
      flush()
      inlines.push({ type: 'ruby', base: auto[1] as string, reading: auto[2] as string })
      i += auto[0].length
      continue
    }

    buf += line[i]
    i++
  }
  flush()
  return inlines
}
