/**
 * 小説の推敲（COT-30・COT-40）の型。
 * 脚本の `ScriptNotice`（../script/proofread.ts）と同じ形の `ProofNotice` は、脚本の書式チェックの表示が使う。
 * 小説の推敲画面は位置つきの `Finding` だけを見る。
 */
export interface ProofNotice {
  blockIndex: number
  code: string
  message: string
}

export type NovelRuleId =
  | 'indent'
  | 'punct-before-close'
  | 'space-after-exclamation'
  | 'leader-odd'
  | 'halfwidth-punct'
  | 'successive-word'
  | 'variant'
  | 'doubled-particle'
  | 'ra-nuki'

/**
 * 推敲画面の指摘 1 件（出現ごと）。位置は段落のプレーン文字列（plainTextOfBlock）の UTF-16 位置。
 * `text` は「直せば段落から消える文字列」。字下げだけは段落の頭に結び付く（anchor: 'lineStart'）。
 */
export interface Finding {
  blockId: string
  blockIndex: number
  code: NovelRuleId
  start: number
  end: number
  text: string
  anchor: 'contains' | 'lineStart'
  message: string
}

/** 品詞を使う項目（くわしい確認）。解析器の準備ができるまで指摘を出さない。 */
export const MORPH_RULES: ReadonlySet<NovelRuleId> = new Set(['doubled-particle', 'ra-nuki'])

/** 「確認する項目」の切替の並び順と表示名。表記ゆれの自動発見は 'variant' に含める。 */
export const NOVEL_RULES: ReadonlyArray<{ id: NovelRuleId; label: string }> = [
  { id: 'indent', label: '字下げ' },
  { id: 'punct-before-close', label: '閉じ括弧の前の句読点' },
  { id: 'space-after-exclamation', label: '！？の後の空白' },
  { id: 'leader-odd', label: '三点リーダー・ダッシュ' },
  { id: 'halfwidth-punct', label: '半角の約物' },
  { id: 'successive-word', label: '同じ語の連続' },
  { id: 'variant', label: '表記ゆれ' },
  { id: 'doubled-particle', label: '一文の中の同じ助詞' },
  { id: 'ra-nuki', label: 'ら抜き言葉' },
]

export function isNovelRuleId(v: unknown): v is NovelRuleId {
  return typeof v === 'string' && NOVEL_RULES.some((r) => r.id === v)
}

/** 項目の表示名（未知の ID はそのまま返す）。 */
export function novelRuleLabel(id: string): string {
  return NOVEL_RULES.find((r) => r.id === id)?.label ?? id
}
