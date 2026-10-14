/**
 * 形態素解析のトークン（COT-40）。解析器（lindera-wasm・IPADIC）の出力を自前の型に写したもの。
 * core はライブラリに依存しない。Worker が `RawToken`（表層形＋details の配列）を作り、ここで位置を付ける。
 *
 * IPADIC の details の並び：品詞, 細分類1, 細分類2, 細分類3, 活用型, 活用形, 原形, 読み, 発音。
 * 未知語やユーザー辞書の語は欄が欠けることがあるので、欠けた欄は '*' とみなす。
 */
export interface MorphToken {
  surface: string
  /** 段落のプレーン文字列の UTF-16 位置。 */
  start: number
  end: number
  pos: string
  pos1: string
  ctype: string
  cform: string
  base: string
  reading: string
}

/** [表層形, ...details]。Worker から渡しやすい素の配列。 */
export type RawToken = string[]

/**
 * 素のトークン列に、元の文字列の中での位置を付ける。
 * 表層形を元の文字列の中で前から順に探すので、解析器が空白や未知の文字を落としても位置はずれない。
 */
export function toMorphTokens(raw: ReadonlyArray<RawToken>, text: string): MorphToken[] {
  const out: MorphToken[] = []
  let cursor = 0
  for (const r of raw) {
    const surface = r[0] ?? ''
    if (!surface) continue
    const at = text.indexOf(surface, cursor)
    const start = at === -1 ? cursor : at
    const end = Math.min(text.length, start + surface.length)
    cursor = end
    const d = (i: number) => r[i + 1] ?? '*'
    out.push({
      surface,
      start,
      end,
      pos: d(0),
      pos1: d(1),
      ctype: d(4),
      cform: d(5),
      base: d(6),
      reading: d(7),
    })
  }
  return out
}
