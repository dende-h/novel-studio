import { plainTextOfBlock } from '../game'
import type { Block, Episode } from '../schema'
import { checkLine } from './rules'
import type { NovelRuleId, ProofNotice } from './types'
import { countVariants, mergeCounts, type VariantCounts, variantNoticesForLine } from './variants'

export type { NovelRuleId, ProofNotice } from './types'
export { isNovelRuleId, NOVEL_RULES } from './types'
export type { VariantCounts } from './variants'

export interface ProofreadNovelOptions {
  /** オフにした項目。候補も集計も作らない。 */
  disabled?: ReadonlySet<NovelRuleId>
  /** 他の話の表記ゆれ集計（`createVariantCountCache` の結果）。いまの話の分はここで足す。 */
  baseCounts?: VariantCounts
}

/**
 * 小説の推敲チェック。本文の修正や保存・書き出しの制限は行わない。
 * 入力の blocks は書き換えない。
 */
export function proofreadNovel(blocks: Block[], opts: ProofreadNovelOptions = {}): ProofNotice[] {
  const disabled = opts.disabled ?? new Set<NovelRuleId>()
  const texts = blocks.map(plainTextOfBlock)
  const counts = disabled.has('variant')
    ? null
    : mergeCounts(opts.baseCounts ?? {}, countVariants(texts))
  const notices: ProofNotice[] = []
  texts.forEach((text, blockIndex) => {
    for (const hit of checkLine(text)) {
      if (!disabled.has(hit.code))
        notices.push({ blockIndex, code: hit.code, message: hit.message })
    }
    if (counts) {
      for (const message of variantNoticesForLine(text, counts)) {
        notices.push({ blockIndex, code: 'variant', message })
      }
    }
  })
  return notices
}

/** 1 話分の表記ゆれ集計。 */
export function countVariantsInBlocks(blocks: Block[]): VariantCounts {
  return countVariants(blocks.map(plainTextOfBlock))
}

/**
 * 話ごとの集計キャッシュ。同じ `Episode` 参照には前回の結果を返す。
 * 自動保存で `work.episodes` が作り直されても、編集していない話の参照は変わらないので再計算は起きない。
 */
export function createVariantCountCache(): (episodes: Episode[]) => VariantCounts {
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
