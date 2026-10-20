import type { RuleRef, VariantRef } from '../types'

/** 段落の中の指摘 1 件（品詞を使うルールの戻り値。段落 ID などは index.ts が付ける）。 */
export interface MorphHit {
  start: number
  end: number
  text: string
  message: string
  /** 作品の例外（COT-62）に使うキーと表示名。 */
  rule?: RuleRef
  /** 表記ゆれの組（COT-62）。 */
  variant?: VariantRef
}
