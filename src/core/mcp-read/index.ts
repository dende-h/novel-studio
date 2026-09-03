/**
 * MCP 読み取りの「応答サイズの判断」だけを持つ純ロジック。
 *
 * 背景：読み取りツールは作品単位の全量をプレーンテキスト 1 本で返してきた。作品が育つと
 * ホスト側（Genspark で実測：約 15,000 バイトは通過、140,000／210,000 バイトは破棄）の上限に
 * 当たり、**中身を一度も見られないまま捨てられる**。しかも捨てるのはクライアントなので、
 * サーバ側からは成功に見える。
 *
 * そこで「全量が予算に収まらなければ、同じ器の**索引**に切り替えて必ず何かを返す」を
 * 1 箇所で保証する。各ツールが自前で気をつける形にしない（ばらつくと AI が挙動を学習できない）。
 *
 * ここは判断だけを持ち、整形は `src/core/exporter/` に任せる（既存の「正本 → 文字列」の流儀を
 * 崩さないため、exporter に offset / limit を持ち込まない）。
 */

/**
 * 既定の応答予算（設定系の全量返却＝用語集・世界観設定・プロット・構造データ）。
 * 実測の破棄ライン 140,000 バイトより下に置く。日本語は 1 字 3 バイトなので、
 * **約 40,000 字**（用語集なら 300 字 × 130 項目ほど）を超えた作品で索引に切り替わる。
 */
export const DEFAULT_FULL_BYTES = 120_000
/**
 * 既定の応答予算（本文＝get_work）。設定系より高くしてある。
 * 本文は途中で切れないので縮退先が「話の索引」しかなく、通し読み・全文推敲の用途では
 * 索引に落ちた瞬間に役に立たなくなる。**約 100,000 字＝3,000 字の話で 33 話**までは
 * 従来どおり全文が返る。それを超える作品は episode_id で話ごとに読む。
 */
export const DEFAULT_TEXT_BYTES = 300_000
/** 既定の応答予算（索引ツール）。索引はそもそも軽いので、事故防止の天井として置く。 */
export const DEFAULT_INDEX_BYTES = 60_000
/** get_work_map の固定予算。「詰まったときに最後に呼べる軽い口」なので小さく固定する。 */
export const WORK_MAP_BYTES = 8_000
/** max_bytes の下限（これ未満を指定されても、実質何も返せないので切り上げる）。 */
export const MIN_MAX_BYTES = 8_000
/** max_bytes の上限。 */
export const MAX_MAX_BYTES = 1_000_000

/** UTF-8 のバイト長。`String.length` は UTF-16 単位で、日本語では実バイトの約 1/3 になる。 */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/** 数値・数値文字列を整数へ。判別できなければ undefined（呼び出し側が既定へ倒す）。 */
export function toInt(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : undefined
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? Math.trunc(n) : undefined
  }
  return undefined
}

/** 件数などの整数引数を安全に受ける（範囲外は丸める・判別不能は既定へ）。 */
export function clampInt(
  raw: unknown,
  opts: { min: number; max: number; fallback: number },
): number {
  const n = toInt(raw)
  if (n === undefined) return opts.fallback
  return Math.min(opts.max, Math.max(opts.min, n))
}

/**
 * max_bytes 引数を実効予算へ。**0 は「無制限」＝従来どおりの全量**（利用者が自力で
 * 改修前の挙動へ戻せる唯一の逃げ道なので、これは必ず残す）。負値・判別不能は既定へ倒す。
 */
export function resolveMaxBytes(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback
  const n = toInt(raw)
  if (n === undefined || n < 0) return fallback
  if (n === 0) return 0
  return Math.min(MAX_MAX_BYTES, Math.max(MIN_MAX_BYTES, n))
}

export interface Page {
  /** 実際に返す範囲（0 起点・end は排他）。 */
  start: number
  end: number
  total: number
  /** 続きがあるときの次の offset。無ければ null。 */
  nextOffset: number | null
}

/** offset / limit を総件数に合わせて丸める（範囲外でも空にせず、必ず読める窓を返す）。 */
export function paginate(
  total: number,
  offset: unknown,
  limit: unknown,
  defaultLimit: number,
): Page {
  const off = clampInt(offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 })
  const lim = clampInt(limit, { min: 1, max: 1000, fallback: defaultLimit })
  // offset が総件数を超えたら最後の窓へ寄せる（「範囲外なので 0 件」は AI から見て行き止まり）。
  const start = total === 0 ? 0 : Math.min(off, Math.max(0, total - 1))
  const end = Math.min(total, start + lim)
  return { start, end, total, nextOffset: end < total ? end : null }
}

/** 行単位で予算に収める（行の途中では切らない）。落とした行数も返す。 */
export function clipLinesToBytes(
  lines: string[],
  maxBytes: number,
): { lines: string[]; dropped: number } {
  if (maxBytes <= 0) return { lines, dropped: 0 }
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = utf8Bytes(line) + 1 // 改行ぶん
    if (used + cost > maxBytes) break
    kept.push(line)
    used += cost
  }
  return { lines: kept, dropped: lines.length - kept.length }
}

export interface FitCount {
  /** 実際に載せる件数。項目が 1 件以上あるなら必ず 1 以上（0 件は AI から見て行き止まり）。 */
  count: number
  /** 予算のために落とした件数。呼び出し側はこれで next_offset と案内文を作り直す。 */
  dropped: number
}

/**
 * **整形する前に**項目数を予算へ収める（行ではなく項目で数える）。
 *
 * 索引は 1 項目 1 行とはかぎらない（世界観設定は冒頭プレビューで 2 行になり、見出しや
 * 「まだ書かれていない枠」の行も混ざる）。整形後の文字列を行で切ると「何項目載ったか」が
 * 呼び出し側から分からなくなり、next_offset と構造化データが本文とずれる。案内どおり
 * next_offset へ進んだ AI が、落ちた項目を読まないまま飛ばす。
 *
 * `overheadBytes` は項目以外に必ず載るもの（案内文・見出し）の合計バイト。
 * `itemTexts` の 1 件は改行 1 つぶん（+1 バイト）を足して数える。
 */
export function fitItemsToBytes(
  itemTexts: string[],
  overheadBytes: number,
  maxBytes: number,
): FitCount {
  if (maxBytes <= 0) return { count: itemTexts.length, dropped: 0 }
  let used = overheadBytes
  let count = 0
  for (const t of itemTexts) {
    const cost = utf8Bytes(t) + 1 // 改行ぶん
    if (used + cost > maxBytes) break
    used += cost
    count += 1
  }
  // 1 件も入らない予算でも 1 件は返す（予算超過より、次の一手が打てないほうが悪い）。
  if (count === 0 && itemTexts.length > 0) count = 1
  return { count, dropped: itemTexts.length - count }
}

export interface BudgetHeaderInput {
  /** 縮退したか。false のときヘッダは出さない（＝従来どおりの出力）。 */
  truncated: boolean
  /** 縮退後の形（index / episodes など）。 */
  mode: string
  maxBytes: number
  fullBytes?: number
  page?: Page
  /** 復旧の道筋。**既存ツール名＋引数の実例**を必ず入れる（新ツールが見えないホスト対策）。 */
  recovery: string[]
}

/**
 * 縮退したときに応答の先頭へ置く案内。1 行目は機械可読、以降は日本語で次の一手を書く。
 * サイズ超過は `isError` にしない（エラーにすると、AI は「読めない」で終わってしまう）。
 */
export function budgetNotice(input: BudgetHeaderInput): string {
  const { page } = input
  const fields = [
    'truncated=true',
    `mode=${input.mode}`,
    `max_bytes=${input.maxBytes}`,
    ...(input.fullBytes !== undefined ? [`full_bytes=${input.fullBytes}`] : []),
    ...(page ? [`total=${page.total}`, `shown=${page.start + 1}-${page.end}`] : []),
    ...(page ? [`next_offset=${page.nextOffset ?? 'null'}`] : []),
  ]
  const head = `[${fields.join(' ')}]`
  const size =
    input.fullBytes !== undefined
      ? `※ 全文は約 ${input.fullBytes.toLocaleString('en-US')} バイトで、応答の上限（${input.maxBytes.toLocaleString('en-US')} バイト）を超えました。索引に切り替えています。`
      : '※ 応答の上限を超えたため、索引に切り替えています。'
  return [head, size, ...input.recovery.map((r) => `※ ${r}`)].join('\n')
}

/** limit / offset で窓を返したときの案内に渡す材料。 */
export interface PageNoticeInput {
  /** 数える対象の呼び名（例：用語集の項目）。日本語の文の主語になる。 */
  label: string
  page: Page
  /** 次の一手。**既存ツール名＋引数の実例**を必ず入れる（新ツールが見えないホスト対策）。 */
  recovery: string[]
}

/**
 * limit / offset が効いたときに応答の先頭へ置く案内。
 *
 * `budgetNotice` は「上限を超えたので索引へ落とした」告知で、**縮退していない窓には出ない**。
 * その穴で事故が起きる：用語集 400 項目の作品で `get_glossary(offset=0)` を呼んだ AI は、
 * 200 件を受け取って「これで全部」と読み終える。ここは縮退ではないので `truncated=false` と
 * 明示し、総件数と次の offset を必ず書く。1 行目は機械可読・以降は日本語＝budgetNotice と同じ作法。
 */
export function pageNotice(input: PageNoticeInput): string {
  const { page } = input
  const fields = [
    'truncated=false',
    'paged=true',
    `total=${page.total}`,
    `shown=${page.total === 0 ? '0-0' : `${page.start + 1}-${page.end}`}`,
    `next_offset=${page.nextOffset ?? 'null'}`,
  ]
  // 窓に全件が収まったなら「続きがある」と誤解させない（next_offset=null だけでは弱い）。
  const whole = page.total === 0 || (page.start === 0 && page.end === page.total)
  const body = whole
    ? [`※ ${input.label} ${page.total} 件をすべて返しました（窓に全件が収まりました）。`]
    : [
        `※ 全件ではありません。${input.label} ${page.total} 件のうち ${page.start + 1}〜${page.end} 件目だけを返しました。`,
        '※ 窓になったのは limit / offset を渡したためです（応答の上限による縮退ではありません）。',
      ]
  return [`[${fields.join(' ')}]`, ...body, ...input.recovery.map((r) => `※ ${r}`)].join('\n')
}

/**
 * 全量が予算に収まればそのまま返し、超えたら索引へ切り替える（1 段だけ）。
 * `fallback` は遅延評価（超えたときにしか組み立てない＝Workers の CPU を無駄に使わない）。
 */
export function fitToBudget(
  full: string,
  fallback: (fullBytes: number) => string,
  maxBytes: number,
): string {
  if (maxBytes <= 0) return full
  const bytes = utf8Bytes(full)
  if (bytes <= maxBytes) return full
  const index = fallback(bytes)
  // 索引のほうが大きくなる形（短い本文に長いプレビューが付く等）では縮退しない。
  // 「縮退したのに増える」は、この改修が直したい事故そのもの。
  return utf8Bytes(index) < bytes ? index : full
}
