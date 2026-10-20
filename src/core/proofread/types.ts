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
  /** 作品の例外（COT-62）に使うキーと表示名。無い項目は例外を作れない（字下げ・一文の中の同じ助詞など）。 */
  rule?: RuleRef
  /** 表記ゆれの組と書き方（COT-62・表記の好みと書き分けの例外に使う）。 */
  variant?: VariantRef
}

/** 例外のキー（'ra-nuki:<ら抜きの原形>' / 'successive-word:<文字列>' / 'variant:<組>'）と表示名。 */
export interface RuleRef {
  key: string
  label: string
}

/** 表記ゆれの組（COT-62）。 */
export interface VariantRef {
  /** 'dict:<VariantGroup.id>'（数は 'dict:numeral:<助数詞>'）/ 'auto:<原形をソートして | でつないだもの>' */
  group: string
  /** この出現の書き方（辞書の組は書き方の名前、数は '算用'／'漢数字'、自動の組は原形）。 */
  form: string
  /** 組の書き方（そろえる先の候補）。 */
  forms: string[]
  /** 数の書き方なら助数詞。 */
  numeral?: string
}

/** 表記の好み（COT-62）。表記ゆれの指摘を作るときに当てる。 */
export interface VariantPreference {
  group: string
  preferred: string
  forms: ReadonlyArray<string>
}

/** 数の書き方の表示名（'算用' → 算用数字）。 */
export const formDisplay = (variant: Pick<VariantRef, 'numeral'>, form: string): string =>
  variant.numeral ? (form === '算用' ? '算用数字' : form) : form

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
