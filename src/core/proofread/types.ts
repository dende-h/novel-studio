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

/**
 * 「確認する項目」の並び順・表示名・説明（チップにホバーしたときに出す）。表記ゆれの自動発見は 'variant' に含める。
 */
export const NOVEL_RULES: ReadonlyArray<{ id: NovelRuleId; label: string; description: string }> = [
  {
    id: 'indent',
    label: '字下げ',
    description: '段落の頭に全角空白が無い段落を探します。会話文（「で始まる段落）は対象外です。',
  },
  {
    id: 'punct-before-close',
    label: '閉じ括弧の前の句読点',
    description: '「待って。」のように、閉じ括弧の直前にある句読点を探します。',
  },
  {
    id: 'space-after-exclamation',
    label: '！？の後の空白',
    description:
      '「待って！すぐ」のように、！や？の後ろに全角空白を空けずに文が続く箇所を探します。行末と閉じ括弧の前は対象外です。',
  },
  {
    id: 'leader-odd',
    label: '三点リーダー・ダッシュ',
    description:
      '「…」「―」が1つだけ（2つ単位でない）の箇所と、「・・・」で代用した箇所を探します。',
  },
  {
    id: 'halfwidth-punct',
    label: '半角の約物',
    description: '和文の中の半角の「!」「?」「,」「.」を探します。',
  },
  {
    id: 'successive-word',
    label: '同じ語の連続',
    description: '「光がが」「言った言った」のような、打ち間違いらしい繰り返しを探します。',
  },
  {
    id: 'variant',
    label: '表記ゆれ',
    description:
      '作品の中で書き方が混ざっている語を探します（出来る／できる、2人／二人など）。くわしい確認の準備ができると、子供／子どもなどの書き分けも自動で見つけます。',
  },
  {
    id: 'doubled-particle',
    label: '一文の中の同じ助詞',
    description:
      '「材料不足で代替素材で」のように、一文の中で同じ助詞が続く箇所を探します（くわしい確認）。',
  },
  {
    id: 'ra-nuki',
    label: 'ら抜き言葉',
    description: '地の文の「見れる」「来れる」などを探します。会話文は対象外です（くわしい確認）。',
  },
]

export function isNovelRuleId(v: unknown): v is NovelRuleId {
  return typeof v === 'string' && NOVEL_RULES.some((r) => r.id === v)
}

/** 項目の表示名（未知の ID はそのまま返す）。 */
export function novelRuleLabel(id: string): string {
  return NOVEL_RULES.find((r) => r.id === id)?.label ?? id
}
