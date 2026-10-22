import { insideQuotes } from '../quotes'
import type { MorphHit } from './hit'
import type { MorphToken } from './token'

/**
 * ら抜き言葉（COT-40 FR-8c）。地の文だけを調べ、括弧（「」『』）の中は調べない（会話文は口語として許す）。
 * (1) 一段活用の動詞（自立）の未然形の直後に、動詞（接尾）の「れる」が続く（食べ｜れる）
 * (2) 原形が「来れる」「見れる」の動詞（IPADIC は 1 語として持っている）
 */
const SINGLE = new Set(['来れる', '見れる'])

export function raNukiHits(tokens: ReadonlyArray<MorphToken>, text: string): MorphHit[] {
  const inside = insideQuotes(text)
  const hits: MorphHit[] = []
  tokens.forEach((t, i) => {
    if (t.pos !== '動詞' || t.pos1 !== '自立' || inside[t.start]) return
    const next = tokens[i + 1]
    let end = -1
    let fixed = ''
    // 例外（COT-62）のキーは原形のら抜きの形。活用で文字列が変わっても（食べれる・食べれない）同じ例外に当たる
    let form = ''
    if (
      t.ctype.startsWith('一段') &&
      t.cform === '未然形' &&
      next?.pos === '動詞' &&
      next.pos1 === '接尾' &&
      next.base === 'れる'
    ) {
      end = next.end
      fixed = `${t.surface}ら${next.surface}`
      form = `${t.base.slice(0, -1)}れる`
    } else if (SINGLE.has(t.base) && t.surface.length >= 2) {
      end = t.end
      fixed = `${t.surface.slice(0, 1)}ら${t.surface.slice(1)}`
      form = t.base
    }
    if (end < 0) return
    const matched = text.slice(t.start, end)
    hits.push({
      start: t.start,
      end,
      text: matched,
      message: `「${matched}」はら抜き言葉です。地の文では「${fixed}」が一般的です。`,
      rule: { key: `ra-nuki:${form}`, label: form },
    })
  })
  return hits
}
