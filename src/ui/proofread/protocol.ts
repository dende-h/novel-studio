import type {
  AutoVariantCounts,
  EndingKind,
  FrequentWord,
  MorphToken,
  NameCandidate,
} from '@/core/proofread'

/** 推敲画面の解析 Worker とのやりとり（COT-40）。型だけ（実行時のコードは持たない）。 */
export type AnalyzerFailure = 'offline' | 'memory' | 'unsupported' | 'unknown'

export interface AnalyzeEpisode {
  id: string
  /** 段落のプレーン文字列から作る軽いハッシュ。同じなら Worker は解析し直さない。 */
  hash: string
  texts: string[]
  /** 話の記法から取り出したルビと [[ ]]（名前の候補・COT-59）。トークンのキャッシュには関わらない。 */
  rubies?: { base: string; reading: string }[]
  refs?: string[]
}

export type AnalyzerRequest =
  | { type: 'init'; userDictCsv: string; excluded: string[] }
  | { type: 'analyze'; id: number; episodes: AnalyzeEpisode[]; currentId: string }

export interface AnalysisResult {
  /** いまの話のトークン（段落ごと）。作品全体のトークンは Worker の中だけに持つ。 */
  currentTokens: MorphToken[][]
  workVariants: AutoVariantCounts
  /** よく使う言葉（作品全体）。副詞・形容詞・形容動詞。 */
  frequent: FrequentWord[]
  /** よく使う言葉（いまの話）。 */
  frequentCurrent: FrequentWord[]
  /** よく使う接続詞（作品全体・いまの話）。 */
  conjunctions: FrequentWord[]
  conjunctionsCurrent: FrequentWord[]
  /** 文末の偏り（作品全体の地の文）。いまの話の分は画面側でトークンから数える。 */
  endings: { counts: Record<EndingKind, number>; runs: number }
  /** 用語集に無い名前の候補（作品全体・COT-59）。用語集の語は除いてある。 */
  names: NameCandidate[]
}

export type AnalyzerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'error'; reason: AnalyzerFailure }
  | { type: 'workProgress'; id: number; done: number; total: number }
  | ({ type: 'analysis'; id: number } & AnalysisResult)
  | { type: 'analysisError'; id: number; reason: AnalyzerFailure }

/** 辞書（public/dict/・名前は scripts/dict-file.mjs と同じ。IPADIC に SudachiDict の今の言葉を足したもの・COT-59）。 */
export const DICT_URL = '/dict/lindera-ipadic-6.2.0-sudachi20260723.zip'
/** 辞書の大きさ（進み具合の分母。Content-Length が無いときに使う）。 */
export const DICT_BYTES = 11_957_446
