import type { AutoVariantCounts, FrequentWord, MorphToken } from '@/core/proofread'

/** 推敲画面の解析 Worker とのやりとり（COT-40）。型だけ（実行時のコードは持たない）。 */
export type AnalyzerFailure = 'offline' | 'memory' | 'unsupported' | 'unknown'

export interface AnalyzeEpisode {
  id: string
  /** 段落のプレーン文字列から作る軽いハッシュ。同じなら Worker は解析し直さない。 */
  hash: string
  texts: string[]
}

export type AnalyzerRequest =
  | { type: 'init'; userDictCsv: string; excluded: string[] }
  | { type: 'analyze'; id: number; episodes: AnalyzeEpisode[]; currentId: string }

export interface AnalysisResult {
  /** いまの話のトークン（段落ごと）。作品全体のトークンは Worker の中だけに持つ。 */
  currentTokens: MorphToken[][]
  workVariants: AutoVariantCounts
  frequent: FrequentWord[]
}

export type AnalyzerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'error'; reason: AnalyzerFailure }
  | { type: 'workProgress'; id: number; done: number; total: number }
  | ({ type: 'analysis'; id: number } & AnalysisResult)
  | { type: 'analysisError'; id: number; reason: AnalyzerFailure }

/** 辞書（public/dict/・scripts/fetch-dict.mjs と同じ版）。 */
export const DICT_URL = '/dict/lindera-ipadic-6.2.0.zip'
/** 辞書の大きさ（進み具合の分母。Content-Length が無いときに使う）。 */
export const DICT_BYTES = 10_519_550
