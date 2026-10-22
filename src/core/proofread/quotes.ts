/**
 * 括弧（「」『』）の中かどうか（COT-40）。ら抜き言葉（会話文は調べない）とセリフの割合が共用する。
 * 括弧の記号そのものも「中」に数える。閉じていない括弧は行の終わりで閉じたものとみなす。
 * 入れ子（「…『…』…」）は深さで数え、余った閉じ括弧は無視する。
 */
const OPEN = new Set(['「', '『'])
const CLOSE = new Set(['」', '』'])

/** 各 UTF-16 位置が括弧の中か。長さは text.length。 */
export function insideQuotes(text: string): boolean[] {
  const out: boolean[] = new Array(text.length)
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (OPEN.has(ch)) {
      depth++
      out[i] = true
    } else if (CLOSE.has(ch) && depth > 0) {
      out[i] = true
      depth--
    } else {
      out[i] = depth > 0
    }
  }
  return out
}
