import type { MorphHit } from './hit'
import type { MorphToken } from './token'

/**
 * 表記ゆれの自動発見（COT-40 FR-8a）。辞書を手で作らずに、作品の中の書き分けを拾う。
 *
 * - 同じ語：品詞・細分類1・活用型・活用形・読み（表層形の読み）がすべて同じなら、原形（書き方）が違っても同じ語。
 *   活用形ごとに読みが違う（分かっ／ワカッ と 分かる／ワカル）ので、キーを共有した原形どうしをつないで組にする。
 * - 拾う違い：漢字とかな（子供／子ども・事／こと）、同じ漢字で送り仮名違い（行う／行なう）、ひらがなとカタカナ。
 *   片方の漢字の並びがもう片方の漢字の並びに含まれるときだけを書き分けとみなす。漢字が違う同音語（暑い／熱い）は拾わない。
 * - 外す：固有名詞・数・ユーザー辞書の語（カスタム名詞）・用語集の語・読みや原形が無い未知語・記号・助詞・助動詞。
 */
export interface AutoVariantGroup {
  forms: { base: string; count: number }[]
}

/** 作品全体の集計（Worker が全話のトークンから作る）。groupOf のキーは `${品詞}\t${原形}`。 */
export interface AutoVariantCounts {
  groups: AutoVariantGroup[]
  groupOf: Record<string, number>
}

export const emptyAutoVariants = (): AutoVariantCounts => ({ groups: [], groupOf: {} })

const NOUN_POS1 = new Set(['一般', 'サ変接続', '形容動詞語幹', '副詞可能', '非自立'])
const KANJI = /[一-龯々〆]/gu

const nodeOf = (t: MorphToken) => `${t.pos}\t${t.base}`

export function isAutoVariantTarget(t: MorphToken, excluded: ReadonlySet<string>): boolean {
  if (t.base === '*' || !t.base || t.reading === '*' || !t.reading) return false
  if (excluded.has(t.base) || excluded.has(t.surface)) return false
  if (t.pos === '名詞') return NOUN_POS1.has(t.pos1)
  return t.pos === '動詞' || t.pos === '形容詞' || t.pos === '副詞'
}

const kanjiOf = (s: string) => (s.match(KANJI) ?? []).join('')
const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode((c.codePointAt(0) as number) - 0x60))

/** a の文字が順序を保って b に含まれるか（部分列）。 */
function isSubsequence(a: string, b: string): boolean {
  let j = 0
  for (const ch of b) if (ch === a[j]) j++
  return j === a.length
}

/** 2 つの書き方の違いが「ひらく／とじる・送り仮名・かなの種類」だけか。 */
export function isSpellingVariant(a: string, b: string): boolean {
  if (a === b) return false
  const ka = kanjiOf(a)
  const kb = kanjiOf(b)
  if (!ka && !kb) return toHiragana(a) === toHiragana(b)
  return isSubsequence(ka, kb) || isSubsequence(kb, ka)
}

/** 作品全体のトークン（話ごと・段落ごと）から組を作る。2 つ以上の書き方が書き分けの関係にある組だけを残す。 */
export function countAutoVariants(
  tokensByBlock: Iterable<ReadonlyArray<MorphToken>>,
  excluded: ReadonlySet<string>,
): AutoVariantCounts {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const counts = new Map<string, number>()
  const firstOfKey = new Map<string, string>()
  for (const tokens of tokensByBlock) {
    for (const t of tokens) {
      if (!isAutoVariantTarget(t, excluded)) continue
      const node = nodeOf(t)
      if (!parent.has(node)) parent.set(node, node)
      counts.set(node, (counts.get(node) ?? 0) + 1)
      const key = `${t.pos}|${t.pos1}|${t.ctype}|${t.cform}|${t.reading}`
      const first = firstOfKey.get(key)
      if (first === undefined) firstOfKey.set(key, node)
      else union(first, node)
    }
  }
  const members = new Map<string, string[]>()
  for (const node of parent.keys()) {
    const root = find(node)
    const list = members.get(root)
    if (list) list.push(node)
    else members.set(root, [node])
  }
  const result = emptyAutoVariants()
  for (const nodes of members.values()) {
    if (nodes.length < 2) continue
    const bases = nodes.map((n) => n.slice(n.indexOf('\t') + 1))
    const related = bases.some((a, i) => bases.some((b, j) => i !== j && isSpellingVariant(a, b)))
    if (!related) continue
    const index = result.groups.length
    result.groups.push({
      forms: nodes
        .map((n) => ({ base: n.slice(n.indexOf('\t') + 1), count: counts.get(n) ?? 0 }))
        .sort((x, y) => y.count - x.count || x.base.localeCompare(y.base, 'ja')),
    })
    for (const n of nodes) result.groupOf[n] = index
  }
  return result
}

/** 1 段落の自動の表記ゆれ（出現ごと）。範囲は該当トークン、text は表層形。 */
export function autoVariantHits(
  tokens: ReadonlyArray<MorphToken>,
  counts: AutoVariantCounts,
  excluded: ReadonlySet<string>,
): MorphHit[] {
  const hits: MorphHit[] = []
  for (const t of tokens) {
    if (!isAutoVariantTarget(t, excluded)) continue
    const g = counts.groupOf[nodeOf(t)]
    if (g === undefined) continue
    const forms = counts.groups[g]?.forms ?? []
    const others = forms.filter((f) => f.base !== t.base && isSpellingVariant(t.base, f.base))
    if (others.length === 0) continue
    const self = forms.find((f) => f.base === t.base)
    const ordered = [self ?? { base: t.base, count: 0 }, ...others]
    const labels = ordered.map((f) => `「${f.base}」`)
    const joined = labels.length === 2 ? labels.join('と') : labels.join('・')
    const stats = ordered.map((f) => `${f.base} ${f.count}件`).join('・')
    hits.push({
      start: t.start,
      end: t.end,
      text: t.surface,
      message: `${joined}が混ざっています（この作品で ${stats}）。どちらかに揃えると読みやすくなります。`,
    })
  }
  return hits
}
