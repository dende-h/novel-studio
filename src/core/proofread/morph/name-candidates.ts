import type { Block } from '../../schema'
import { isUnknownToken, type MorphToken } from './token'

/**
 * 用語集に無い名前の候補（COT-59 FR-2）。作品全体のトークンと本文の記法（ルビ・[[ ]]）から、
 * 固有名詞らしい語を拾う。保存しない（Worker が作って画面へ渡すだけ）。
 *
 * 手がかり（どれか1つで候補になる）：
 * - katakana：カタカナの名詞が続く区間で、辞書に無い語か固有名詞を含むもの（グランヴェル）
 * - split-kanji：1字の漢字の名詞が2〜3個続く区間（朔／夜 → 朔夜）
 * - honorific：さん・様・ちゃん などの敬称（名詞,接尾,人名）の前の区間
 * - dict-proper：辞書にある 名詞,固有名詞 の2字以上の語（宮森・新宿）
 * - ruby：辞書の読みと違うルビを振った語（黒鉄《くろがね》）
 * - ref：本文で [[ ]] を付けたのに用語集に無い名前
 *
 * 「辞書にある語」は原形が `*` でないトークン。辞書に無い語の細分類（未知語の 固有名詞,組織 など）は
 * 当てにならないので、分類の推定には使わない。
 */
export type NameSignal = 'katakana' | 'split-kanji' | 'honorific' | 'dict-proper' | 'ruby' | 'ref'
export type NameCategory = '人物' | '場所' | '組織'

export interface NameCandidate {
  name: string
  /** 作品全体の本文（記法を解いた文字）での出現回数。 */
  count: number
  /** 出てくる話の数。 */
  episodes: number
  signals: NameSignal[]
  category?: NameCategory
  /** ひらがな。推定できなければ undefined。 */
  reading?: string
}

export interface NameSourceEpisode {
  /** 段落ごとのプレーン文字列（plainTextOfBlock）。 */
  texts: ReadonlyArray<string>
  tokens: ReadonlyArray<ReadonlyArray<MorphToken>>
  rubies?: ReadonlyArray<{ base: string; reading: string }>
  /** [[ ]] の name（trim 済み）。 */
  refs?: ReadonlyArray<string>
}

/** ルビの親文字が「辞書の1語で、読みがルビと同じ」か（Worker が辞書で引く）。 */
export type KnownReading = (base: string, readingKatakana: string) => boolean

/**
 * 敬称の前でも名前にしない一般の語（漢字1字の名前を拾うときの除外と、区間全体の除外）。
 * 試し文で決めた初期値。家族・立場・呼びかけによく敬称が付く語。
 */
export const HONORIFIC_STOP_WORDS: ReadonlySet<string> = new Set([
  '客',
  '店員',
  '母',
  '父',
  '兄',
  '姉',
  '妹',
  '弟',
  '娘',
  '息子',
  '嫁',
  '孫',
  '婆',
  '爺',
  '神',
  '王',
  '皆',
  '奥',
  '嬢',
  '坊',
  '姫',
  '先生',
  '社長',
  '部長',
  '課長',
  '殿下',
  '陛下',
  '旦那',
  '女将',
  '親方',
  '師匠',
])

const KATAKANA = /^[ァ-ヺー]+$/u
const KANJI1 = /^[一-鿿々]$/u
const NUMERIC = /^[0-9０-９〇一二三四五六七八九十百千万億]+$/u
/** 区間に入れない名詞の細分類。 */
const NOT_IN_RUN = new Set(['接尾', '数', '代名詞', '非自立'])

const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode((c.codePointAt(0) as number) - 0x60))
const toKatakana = (s: string) =>
  s.replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode((c.codePointAt(0) as number) + 0x60))

const isNoun = (t: MorphToken) => t.pos === '名詞'
const isHonorific = (t: MorphToken | undefined) =>
  t !== undefined && t.pos === '名詞' && t.pos1 === '接尾' && t.pos2 === '人名'
const isPlaceSuffix = (t: MorphToken | undefined) =>
  t !== undefined && t.pos === '名詞' && t.pos1 === '接尾' && t.pos2 === '地域'
const isKatakanaNoun = (t: MorphToken) => isNoun(t) && t.pos1 !== '接尾' && KATAKANA.test(t.surface)
const isKanji1Noun = (t: MorphToken) =>
  isNoun(t) && !NOT_IN_RUN.has(t.pos1) && KANJI1.test(t.surface)
/** 文字だけの表層形（字下げの全角空白や括弧が辞書に無い語として名詞になることがあるので区間に入れない）。 */
const WORDLIKE = /^[\p{L}\p{N}ー々〆ヶ]+$/u
const isRunNoun = (t: MorphToken) =>
  isNoun(t) && !NOT_IN_RUN.has(t.pos1) && WORDLIKE.test(t.surface)
/** 辞書にある一般の語（固有名詞でない・2字以上）。 */
const isCommonWord = (t: MorphToken) =>
  !isUnknownToken(t) && t.pos1 !== '固有名詞' && [...t.surface].length >= 2

/** 辞書にある固有名詞の細分類から分類を推す。 */
function categoryOfProper(t: MorphToken): NameCategory | undefined {
  if (isUnknownToken(t) || t.pos1 !== '固有名詞') return undefined
  if (t.pos2 === '人名') return '人物'
  if (t.pos2 === '地域') return '場所'
  if (t.pos2 === '組織') return '組織'
  return undefined
}

interface Hit {
  name: string
  signal: NameSignal
  category?: NameCategory
  reading?: string
}

/** 1段落のトークンから手がかりを拾う。 */
function hitsOfTokens(tokens: ReadonlyArray<MorphToken>): Hit[] {
  const hits: Hit[] = []
  const push = (
    run: ReadonlyArray<MorphToken>,
    signal: NameSignal,
    next: MorphToken | undefined,
  ) => {
    const name = run.map((t) => t.surface).join('')
    const single = run.length === 1 ? run[0] : undefined
    let category = single ? categoryOfProper(single) : undefined
    if (isPlaceSuffix(next)) category = '場所'
    if (isHonorific(next)) category = '人物'
    let reading: string | undefined
    if (KATAKANA.test(name)) reading = toHiragana(name)
    else if (
      single &&
      !isUnknownToken(single) &&
      single.reading !== '*' &&
      signal === 'dict-proper'
    )
      reading = toHiragana(single.reading)
    hits.push({ name, signal, category, reading })
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as MorphToken
    // カタカナの区間
    if (isKatakanaNoun(t)) {
      let j = i
      while (j < tokens.length && isKatakanaNoun(tokens[j] as MorphToken)) j++
      const run = tokens.slice(i, j)
      if (run.some((r) => isUnknownToken(r) || r.pos1 === '固有名詞'))
        push(run, 'katakana', tokens[j])
      i = j - 1
      continue
    }
    // 1字の漢字の区間
    if (isKanji1Noun(t)) {
      let j = i
      while (j < tokens.length && isKanji1Noun(tokens[j] as MorphToken)) j++
      if (j - i >= 2) {
        if (j - i <= 3) push(tokens.slice(i, j), 'split-kanji', tokens[j])
        i = j - 1
        continue
      }
    }
    // 辞書の固有名詞（カタカナは上の区間で扱う）
    if (
      isNoun(t) &&
      t.pos1 === '固有名詞' &&
      !isUnknownToken(t) &&
      [...t.surface].length >= 2 &&
      !KATAKANA.test(t.surface)
    ) {
      push([t], 'dict-proper', tokens[i + 1])
    }
  }

  // 敬称の前の区間（ほかの手がかりと重なってもよい。分類の「人物」を付けるため別に拾う）
  for (let i = 1; i < tokens.length; i++) {
    if (!isHonorific(tokens[i])) continue
    let k = i
    while (k > 0 && isRunNoun(tokens[k - 1] as MorphToken)) k--
    // 先頭の辞書にある一般の語（2字以上）は肩書きとして外す（王女リリアーナ様 → リリアーナ）
    while (k < i - 1 && isCommonWord(tokens[k] as MorphToken)) k++
    const run = tokens.slice(k, i)
    if (run.length === 0) continue
    const name = run.map((r) => r.surface).join('')
    if (HONORIFIC_STOP_WORDS.has(name)) continue
    const single = run.length === 1 ? run[0] : undefined
    // 辞書にある一般の語1つだけ（店員さん）は除く。漢字1字（澪ちゃん）は除外リストに無ければ拾う
    if (single && isCommonWord(single)) continue
    hits.push({
      name,
      signal: 'honorific',
      category: '人物',
      reading: KATAKANA.test(name)
        ? toHiragana(name)
        : single && !isUnknownToken(single) && single.reading !== '*' && single.pos1 === '固有名詞'
          ? toHiragana(single.reading)
          : undefined,
    })
  }
  return hits
}

/** 文字列の出現回数（重なりなし・proofread-text.tsx の点線の印と同じ数え方）。 */
function countIn(text: string, word: string): number {
  let n = 0
  let at = text.indexOf(word)
  while (at !== -1) {
    n++
    at = text.indexOf(word, at + word.length)
  }
  return n
}

const CATEGORY_ORDER: NameCategory[] = ['人物', '場所', '組織']

/** 作品全体から名前の候補を作る。 */
export function findNameCandidates(
  episodes: ReadonlyArray<NameSourceEpisode>,
  excluded: ReadonlySet<string>,
  isKnownReading: KnownReading,
): NameCandidate[] {
  const byName = new Map<
    string,
    { signals: Set<NameSignal>; categories: Map<NameCategory, number>; readings: Hit[] }
  >()
  const add = (hit: Hit) => {
    const name = hit.name.trim()
    if (!name || excluded.has(name) || NUMERIC.test(name)) return
    // 1字の語は敬称の前だけ
    if ([...name].length < 2 && hit.signal !== 'honorific') return
    let e = byName.get(name)
    if (!e) {
      e = { signals: new Set(), categories: new Map(), readings: [] }
      byName.set(name, e)
    }
    e.signals.add(hit.signal)
    if (hit.category) e.categories.set(hit.category, (e.categories.get(hit.category) ?? 0) + 1)
    if (hit.reading) e.readings.push(hit)
  }

  for (const ep of episodes) {
    for (const tokens of ep.tokens) for (const hit of hitsOfTokens(tokens)) add(hit)
    for (const r of ep.rubies ?? []) {
      const base = r.base.trim()
      const reading = r.reading.trim()
      if (!base || !reading || isKnownReading(base, toKatakana(reading))) continue
      add({ name: base, signal: 'ruby', reading: toHiragana(reading) })
    }
    for (const ref of ep.refs ?? []) add({ name: ref, signal: 'ref' })
  }

  const out: NameCandidate[] = []
  for (const [name, e] of byName) {
    let count = 0
    let inEpisodes = 0
    for (const ep of episodes) {
      let n = 0
      for (const text of ep.texts) n += countIn(text, name)
      count += n
      if (n > 0) inEpisodes++
    }
    const strong = e.signals.has('ruby') || e.signals.has('ref')
    if (count < (strong ? 1 : 2)) continue
    let category: NameCategory | undefined
    let best = 0
    for (const c of CATEGORY_ORDER) {
      const n = e.categories.get(c) ?? 0
      if (n > best) {
        best = n
        category = c
      }
    }
    // 読みはルビ → 辞書 → カタカナの順
    const reading =
      e.readings.find((h) => h.signal === 'ruby')?.reading ??
      e.readings.find((h) => h.signal === 'dict-proper' || h.signal === 'honorific')?.reading ??
      e.readings[0]?.reading
    out.push({
      name,
      count,
      episodes: inEpisodes,
      signals: [...e.signals],
      ...(category ? { category } : {}),
      ...(reading ? { reading } : {}),
    })
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
}

/** 話の記法からルビと [[ ]] を取り出す（ルビを重ねた [[ ]] のルビも含める）。 */
export function inlineSignalsOf(blocks: ReadonlyArray<Block>): {
  rubies: { base: string; reading: string }[]
  refs: string[]
} {
  const rubies: { base: string; reading: string }[] = []
  const refs: string[] = []
  for (const block of blocks) {
    for (const inline of block.inlines) {
      if (inline.type === 'ruby') rubies.push({ base: inline.base, reading: inline.reading })
      else if (inline.type === 'ref') {
        const name = inline.name.trim()
        if (name) refs.push(name)
        for (const child of inline.children ?? []) {
          if (child.type === 'ruby') rubies.push({ base: child.base, reading: child.reading })
        }
      }
    }
  }
  return { rubies, refs }
}
