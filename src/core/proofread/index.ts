import { plainTextOfBlock } from '../game'
import type { Block, Episode } from '../schema'
import { type AutoVariantCounts, autoVariantHits } from './morph/auto-variant'
import { doubledParticleHits } from './morph/doubled-particle'
import { raNukiHits } from './morph/ra-nuki'
import type { MorphToken } from './morph/token'
import { checkLine } from './rules'
import type { Finding, NovelRuleId } from './types'
import { countVariants, mergeCounts, type VariantCounts, variantFindingsForLine } from './variants'

export type { DialogueRatio } from './dialogue-ratio'
export { addRatio, dialoguePercent, dialogueRatio } from './dialogue-ratio'
export type { AutoVariantCounts } from './morph/auto-variant'
export { countAutoVariants, emptyAutoVariants } from './morph/auto-variant'
export type { FrequentWord } from './morph/frequent-words'
export { frequentWords } from './morph/frequent-words'
export type { MorphToken, RawToken } from './morph/token'
export { toMorphTokens } from './morph/token'
export type { Finding, NovelRuleId, ProofNotice } from './types'
export { isNovelRuleId, MORPH_RULES, NOVEL_RULES, novelRuleLabel } from './types'
export type { VariantCounts } from './variants'

export interface ProofreadNovelOptions {
  /** オフにした項目。指摘も集計も作らない。 */
  disabled?: ReadonlySet<NovelRuleId>
  /** 他の話の表記ゆれ集計（`createVariantCountCache` の結果）。いまの話の分はここで足す。 */
  baseCounts?: VariantCounts
  /** くわしい確認（形態素解析）の材料。無ければ品詞を使う指摘は出さない。 */
  morph?: {
    /** いまの話のトークン。blocks と同じ並び。 */
    tokens: ReadonlyArray<ReadonlyArray<MorphToken>>
    /** 作品全体の自動の表記ゆれ集計（Worker が作る）。 */
    workVariants: AutoVariantCounts
    /** 用語集の名前・別名（指摘の対象から外す）。 */
    excluded: ReadonlySet<string>
  }
}

const CODE_ORDER: Record<NovelRuleId, number> = {
  indent: 0,
  'punct-before-close': 1,
  'space-after-exclamation': 2,
  'leader-odd': 3,
  'halfwidth-punct': 4,
  'successive-word': 5,
  variant: 6,
  'doubled-particle': 7,
  'ra-nuki': 8,
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/**
 * 小説の推敲（COT-40）。出現ごとに位置つきの指摘を返す。本文の修正や保存・書き出しの制限は行わない。
 * blocks は保存済み（id 付き）。入力の blocks は書き換えない。並びは段落の順・位置の順・項目の順。
 * 自動の表記ゆれは、辞書の表記ゆれと範囲が重なる出現には出さない（辞書の指摘は解析器の有無で変わらない）。
 */
export function proofreadNovel(
  blocks: ReadonlyArray<Block>,
  opts: ProofreadNovelOptions = {},
): Finding[] {
  const disabled = opts.disabled ?? new Set<NovelRuleId>()
  const texts = blocks.map(plainTextOfBlock)
  const counts = disabled.has('variant')
    ? null
    : mergeCounts(opts.baseCounts ?? {}, countVariants(texts))
  const findings: Finding[] = []
  texts.forEach((text, blockIndex) => {
    const blockId = (blocks[blockIndex] as Block).id
    const push = (
      code: NovelRuleId,
      h: { start: number; end: number; text: string; message: string },
      anchor: Finding['anchor'] = 'contains',
    ) => findings.push({ blockId, blockIndex, code, anchor, ...h })
    for (const h of checkLine(text)) {
      if (!disabled.has(h.code)) push(h.code, h, h.anchor)
    }
    const dictVariants = counts ? variantFindingsForLine(text, counts) : []
    for (const v of dictVariants) push('variant', v)
    const morph = opts.morph
    const tokens = morph?.tokens[blockIndex]
    if (!morph || !tokens || !text.trim()) return
    if (!disabled.has('variant')) {
      for (const h of autoVariantHits(tokens, morph.workVariants, morph.excluded)) {
        if (!dictVariants.some((d) => overlaps(d, h))) push('variant', h)
      }
    }
    if (!disabled.has('doubled-particle')) {
      for (const h of doubledParticleHits(tokens, text)) push('doubled-particle', h)
    }
    if (!disabled.has('ra-nuki')) {
      for (const h of raNukiHits(tokens, text)) push('ra-nuki', h)
    }
  })
  return findings.sort(
    (a, b) =>
      a.blockIndex - b.blockIndex || a.start - b.start || CODE_ORDER[a.code] - CODE_ORDER[b.code],
  )
}

/** 1 話分の表記ゆれ集計。 */
export function countVariantsInBlocks(blocks: ReadonlyArray<Block>): VariantCounts {
  return countVariants(blocks.map(plainTextOfBlock))
}

/**
 * 話ごとの集計キャッシュ。同じ `Episode` 参照には前回の結果を返す。
 * 自動保存で `work.episodes` が作り直されても、編集していない話の参照は変わらないので再計算は起きない。
 */
export function createVariantCountCache(): (episodes: ReadonlyArray<Episode>) => VariantCounts {
  const cache = new WeakMap<Episode, VariantCounts>()
  return (episodes) => {
    let total: VariantCounts = {}
    for (const ep of episodes) {
      let counts = cache.get(ep)
      if (!counts) {
        counts = countVariantsInBlocks(ep.blocks)
        cache.set(ep, counts)
      }
      total = mergeCounts(total, counts)
    }
    return total
  }
}
