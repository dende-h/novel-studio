/**
 * 小説の推敲チェック（COT-30）の型。
 * 脚本の `ScriptNotice`（../script/proofread.ts）と同じ形に揃え、UI はこの形だけを見る。
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

/** 「確認する項目」の切替の並び順と表示名。 */
export const NOVEL_RULES: ReadonlyArray<{ id: NovelRuleId; label: string }> = [
  { id: 'indent', label: '字下げ' },
  { id: 'punct-before-close', label: '閉じ括弧の前の句読点' },
  { id: 'space-after-exclamation', label: '！？の後の空白' },
  { id: 'leader-odd', label: '三点リーダー・ダッシュ' },
  { id: 'halfwidth-punct', label: '半角の約物' },
  { id: 'successive-word', label: '同じ語の連続' },
  { id: 'variant', label: '表記ゆれ' },
]

export function isNovelRuleId(v: unknown): v is NovelRuleId {
  return typeof v === 'string' && NOVEL_RULES.some((r) => r.id === v)
}
