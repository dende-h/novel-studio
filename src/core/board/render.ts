import { markdownToHtml, stripMarkdown } from '../markdown'
import { extractUrls } from './link'

/**
 * 掲示板の本文を表示用の HTML にする純ロジック。React・DOM に依存しない。
 *
 * 本文は**赤の他人が書いた文字列**なので、描画は「何を通すか」ではなく
 * 「何も通さないところから、安全と確かめた記号だけを足す」向きで書く。行内でやるのは
 * 3 つだけ ——(1) HTML エスケープ (2) `**強調**` (3) 裸の URL の自動リンク。
 *
 * 既存の `markdownToHtml` をそのままは使えない（設計書 09-board §6）。あれは小説の
 * 執筆画面向けで、行内を `parseInlines` へ委譲するため
 * - `[[用語]]` を参照として消費する（掲示板に用語の解決先が無い）
 * - ルビ・傍点を解釈する
 * - 数字に縦中横の `<span class="tcy">` を挿す（横組みの掲示板では邪魔で、
 *   `?b=1` のような URL をリンクの途中で割ってしまう）
 * - 裸の URL をリンクにしない
 * が困る。とはいえ見出し・箇条書き・引用・表のブロック解釈をもう 1 本書くと、記法が
 * 2 箇所に分かれていつか必ずずれる。そこで **ブロック層は markdownToHtml を使い回し、
 * 行内だけを差し替える**（`InlineRenderer`）。
 *
 * URL の切り出し規則は `link.ts` の `extractUrls` が正本。ここは「本文のどこにあるか」を
 * 知るために同じ形の走査を持つが、リンクにするのは extractUrls も URL と認めた文字列だけ
 * ＝規則がずれても link.ts より広くリンクすることはない（render.test.ts で一致を固定）。
 */

// ---------------------------------------------------------------------------
// エスケープ
// ---------------------------------------------------------------------------

/**
 * HTML の特殊文字を実体参照へ。テキストにも属性値にも同じものを使う
 * （`"` と `'` の両方を潰すので、href をどちらの引用符で囲んでも抜け出せない）。
 * `&` を最初に置き換えるのが要点＝あとから作った `&lt;` を二重にエスケープしない。
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ---------------------------------------------------------------------------
// 自動リンク
// ---------------------------------------------------------------------------

/**
 * 裸の URL の走査。`link.ts` の URL_BODY_RE と同じ文字集合（RFC 3986 の予約語＋非予約語）。
 * link.ts は正規表現を export していないので写しを持つが、採用は extractUrls の結果と
 * 突き合わせてからなので、写しが緩んでもリンクは増えない。
 *
 * `"` `<` `>` が文字集合に無いことが安全側に効く。`https://x/"onmouseover="alert(1)` は
 * `"` の手前で切れ、残りはただのテキストとしてエスケープされる。
 */
const URL_SCAN_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi

/** リンクに許すスキーム。`javascript:` `data:` `vbscript:` は素のテキストのまま出す。 */
const LINKABLE_PROTOCOLS = new Set(['http:', 'https:'])

/** 末尾にあれば URL の一部と見なさない ASCII 約物（link.ts の TRAILING_PUNCTUATION と同じ）。 */
const TRAILING_PUNCTUATION = '.,;:!?\'"'

function countChar(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n++
  return n
}

/** 末尾の約物を削る（link.ts の trimTrailing と同じ規則）。 */
function trimTrailing(url: string): string {
  let out = url
  for (;;) {
    const last = out.at(-1)
    if (last === undefined) return out
    if (TRAILING_PUNCTUATION.includes(last)) {
      out = out.slice(0, -1)
      continue
    }
    if (last === ')' && countChar(out, ')') > countChar(out, '(')) {
      out = out.slice(0, -1)
      continue
    }
    if (last === ']' && countChar(out, ']') > countChar(out, '[')) {
      out = out.slice(0, -1)
      continue
    }
    return out
  }
}

/** 本文中の URL の位置。end は URL の直後（半開区間）。 */
type UrlSpan = { start: number; end: number; url: string }

/**
 * 行の中の URL の位置を出現順で返す。extractUrls が URL と認めなかった文字列は捨てる
 * ＝「リンクになるもの」の集合は link.ts が決める。
 */
function urlSpansOf(line: string): UrlSpan[] {
  const allowed = new Set(extractUrls(line))
  const spans: UrlSpan[] = []
  for (const m of line.matchAll(URL_SCAN_RE)) {
    if (m.index === undefined) continue
    const url = trimTrailing(m[0])
    if (!allowed.has(url)) continue
    spans.push({ start: m.index, end: m.index + url.length, url })
  }
  return spans
}

/**
 * href に出してよい URL か。走査の時点で http(s) しか拾わないので二重の確認だが、
 * 「リンクにする直前にスキームを見る」形を残しておく（走査を緩めた人がここで止まる）。
 */
function isLinkable(url: string): boolean {
  try {
    return LINKABLE_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * 1 本ぶんのアンカー。`rel` は掲示板の外部リンクの既定（設計書 §3.2）。
 * - `nofollow ugc` … 利用者が貼った先へ検索評価を渡さない（スパムの動機を削る）
 * - `noopener noreferrer` … 開いた先から `window.opener` を触らせず、参照元も渡さない
 */
function anchorHtml(url: string): string {
  if (!isLinkable(url)) return escapeHtml(url)
  const href = escapeHtml(url)
  return `<a href="${href}" target="_blank" rel="nofollow ugc noopener noreferrer">${escapeHtml(url)}</a>`
}

// ---------------------------------------------------------------------------
// 行内の描画
// ---------------------------------------------------------------------------

/** 位置 i から始まる URL があれば返す。 */
function spanAt(spans: UrlSpan[], i: number): UrlSpan | undefined {
  return spans.find((s) => s.start === i)
}

/** 位置 i が URL の内側なら true（URL の中の `**` を強調の記号にしないための判定）。 */
function insideSpan(spans: UrlSpan[], i: number): boolean {
  return spans.some((s) => i >= s.start && i < s.end)
}

/** from 以降で最初に現れる、URL の外側の `**` の位置。無ければ -1。 */
function closingBoldAt(line: string, from: number, spans: UrlSpan[]): number {
  let i = from
  for (;;) {
    const at = line.indexOf('**', i)
    if (at < 0) return -1
    if (!insideSpan(spans, at)) return at
    i = at + 1
  }
}

/**
 * 掲示板の行内描画。エスケープ → `**強調**` → 裸の URL の自動リンク、だけを行う。
 * `[[用語]]`・ルビ（`|親《よみ》`）・傍点・縦中横は**解釈せず、書いたままの文字として出す**。
 *
 * 強調は対になったときだけ消費し、対にならない `**` はただの文字として残す
 * （既存の markdownToHtml の行内と同じ振る舞い）。URL の内側の `**` は記号と見なさない
 * ＝ `https://x/a**b` でリンクが割れない。`*` は URL に使える文字なので `**url**` の閉じ側は
 * URL に飲まれるが、そこは**URL を優先する**。強調を優先して短く切ると、リンクの飛び先と
 * link.ts が OGP を取りに行く URL がずれる（同じ本文から別の URL が出てくる状態を作らない）。
 */
export function boardInlineHtml(text: string): string {
  const spans = urlSpansOf(text)
  let html = ''
  let plain = ''
  const flush = () => {
    if (plain !== '') {
      html += escapeHtml(plain)
      plain = ''
    }
  }
  let i = 0
  let strongOpen = false
  while (i < text.length) {
    const span = spanAt(spans, i)
    if (span) {
      flush()
      html += anchorHtml(span.url)
      i = span.end
      continue
    }
    if (text.startsWith('**', i) && !insideSpan(spans, i)) {
      if (strongOpen) {
        flush()
        html += '</strong>'
        strongOpen = false
        i += 2
        continue
      }
      // 閉じがあるときだけ開く（中身が空の `****` は開かない＝ただの文字）。
      const end = closingBoldAt(text, i + 2, spans)
      if (end > i + 2) {
        flush()
        html += '<strong>'
        strongOpen = true
        i += 2
        continue
      }
    }
    plain += text[i]
    i++
  }
  flush()
  // 開いたのは閉じを見つけたときだけなので通常ここへは来ない（タグの閉じ忘れ防止の保険）。
  if (strongOpen) html += '</strong>'
  return html
}

// ---------------------------------------------------------------------------
// 本文の描画
// ---------------------------------------------------------------------------

/**
 * 掲示板の本文（生テキスト）→ 表示用 HTML。
 * ブロック（見出し・箇条書き・引用・表・区切り線・段落）は markdownToHtml のものをそのまま
 * 使い回し、行内だけ boardInlineHtml へ差し替える。生の HTML はどの経路でも通らない。
 */
export function boardBodyToHtml(text: string): string {
  return markdownToHtml(text, undefined, boardInlineHtml)
}

/**
 * 一覧の抜粋用に、記法の記号を剥がした 1 行を返す。
 * HTML ではなくテキストを返す（埋め込む側が textContent として扱う前提）。
 * 改行・連続空白は空白ひとつに畳む＝カードの 1 行に収まる。
 */
export function boardBodyToPlain(text: string): string {
  return stripMarkdown(text).replace(/\s+/g, ' ').trim()
}
