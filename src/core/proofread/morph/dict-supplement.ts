/**
 * 解析辞書に足す語の選び方（COT-59 FR-1）。SudachiDict の普通名詞のうち、IPADIC が誤って区切る語だけを
 * IPADIC の形式の CSV 行にする。scripts/build-dict.mjs が Node の型除去でこのファイルをそのまま読むので、
 * import を持たない（型だけの記法と、そのまま消せる構文に限る）。
 *
 * 足さない語（試作で決めた線。名前が割れるのを防ぐ）：
 * - ひらがなだけの語（文の途中に誤って当たる）
 * - 3字以下のカタカナ語（シェリス→シェ／リス のように架空の名前が割れる）。ただし core の3字の語は足す（スマホ・コスパ）
 * - Sudachi の重みが0の行（怪しい行）
 */

export type SudachiSubPos = '一般' | 'サ変可能' | '形状詞可能'

export interface SudachiNoun {
  surface: string
  sub: SudachiSubPos
  /** Sudachi の読み（カタカナ）。 */
  reading: string
  source: 'small' | 'core'
  cost: number
}

/** IPADIC でその語を解析したときの区切られ方。 */
export type SplitKind = 'known' | 'unknown' | 'proper' | 'split-kanji' | 'other'

export interface SplitToken {
  surface: string
  /** 辞書に無い語（原形が `*`）。 */
  unknown: boolean
  pos1: string
}

const SURFACE = /^[ぁ-ゖァ-ヺー・一-鿿々〆ヶ]{2,}$/u
const HIRAGANA_ONLY = /^[ぁ-ゖー]+$/u
const KATAKANA_ONLY = /^[ァ-ヺー・]+$/u
const KATAKANA_READING = /^[ァ-ヺー]+$/u
const KANJI1 = /^[一-鿿々]$/u

const SUB_POS: Record<SudachiSubPos, { id: number; pos: string }> = {
  一般: { id: 1285, pos: '名詞,一般' },
  サ変可能: { id: 1283, pos: '名詞,サ変接続' },
  形状詞可能: { id: 1287, pos: '名詞,形容動詞語幹' },
}

/** IPADIC の名詞の中央値（カタカナ 3657・それ以外 5622）。足す語が既存の語より強く当たりすぎないように。 */
const COST_KATAKANA = 3657
const COST_OTHER = 5622

/**
 * Sudachi の CSV の1行（v0 形式）から普通名詞を取り出す。対象外なら null。
 * 列：0 表層形, 3 コスト, 5〜10 品詞, 11 読み。
 */
export function parseSudachiRow(
  cols: ReadonlyArray<string>,
  source: 'small' | 'core',
): SudachiNoun | null {
  if (cols[5] !== '名詞' || cols[6] !== '普通名詞') return null
  const sub = cols[7]
  if (sub !== '一般' && sub !== 'サ変可能' && sub !== '形状詞可能') return null
  const surface = cols[0] ?? ''
  if (!SURFACE.test(surface)) return null
  return { surface, sub, reading: cols[11] ?? '', source, cost: Number(cols[3]) }
}

/** IPADIC の解析結果から、区切られ方を分ける。 */
export function classifySplit(tokens: ReadonlyArray<SplitToken>): SplitKind {
  if (tokens.length === 1 && !tokens[0]?.unknown) return 'known'
  if (tokens.some((t) => t.unknown)) return 'unknown'
  if (tokens.some((t) => t.pos1 === '固有名詞')) return 'proper'
  if (tokens.length <= 3 && tokens.every((t) => KANJI1.test(t.surface))) return 'split-kanji'
  return 'other'
}

/** 選び方の線（区切られ方を除く）。 */
export function passesFilter(n: SudachiNoun): boolean {
  if (HIRAGANA_ONLY.test(n.surface)) return false
  if (n.cost === 0) return false
  if (KATAKANA_ONLY.test(n.surface)) {
    const len = [...n.surface].length
    if (len < 4 && !(len === 3 && n.source === 'core')) return false
  }
  return true
}

/** IPADIC の CSV 行（13列：表層形, 左ID, 右ID, コスト, 品詞×6, 原形, 読み, 発音）。 */
export function toIpadicRow(n: SudachiNoun): string {
  const { id, pos } = SUB_POS[n.sub]
  const cost = KATAKANA_ONLY.test(n.surface) ? COST_KATAKANA : COST_OTHER
  const reading = KATAKANA_READING.test(n.reading) ? n.reading : '*'
  return [n.surface, id, id, cost, pos, '*', '*', '*', '*', n.surface, reading, reading].join(',')
}

const ADD: ReadonlySet<SplitKind> = new Set(['unknown', 'proper', 'split-kanji'])

/**
 * 足す語の CSV 行を返す。同じ表層形は最初の1件だけ（small を先に渡す）。
 * splitOf は IPADIC で表層形を解析した区切られ方（build-dict.mjs が lindera で引く）。
 */
export function selectSupplement(
  nouns: Iterable<SudachiNoun>,
  splitOf: (surface: string) => SplitKind,
): string[] {
  const seen = new Set<string>()
  const rows: string[] = []
  for (const n of nouns) {
    if (seen.has(n.surface)) continue
    seen.add(n.surface)
    if (!passesFilter(n)) continue
    if (!ADD.has(splitOf(n.surface))) continue
    rows.push(toIpadicRow(n))
  }
  return rows
}
