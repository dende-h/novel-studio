import {
  countAutoVariants,
  ENDING_KINDS,
  emptyEndingCounts,
  findNameCandidates,
  frequentWords,
  isUnknownToken,
  type MorphToken,
  type NameSourceEpisode,
  type RawToken,
  sentenceEndings,
  toMorphTokens,
} from '@/core/proofread'
import type { AnalysisResult, AnalyzeEpisode, AnalyzerFailure } from './protocol'
import { unzipEntries } from './unzip'

/**
 * 解析の本体（COT-40）。Worker（analyzer.worker.ts）から使う。Node のテストでも動かせるよう、
 * lindera のモジュールと辞書 zip の取得は外から渡す。作品全体のトークンはこの中だけに持ち、
 * 呼び出し側にはいまの話のトークンと作品全体の集計だけを返す。
 */

/** lindera-wasm のうち使う部分（型は最小限）。 */
export interface LinderaLike {
  loadDictionaryFromBytes(...files: Uint8Array[]): { readonly metadata: unknown }
  loadUserDictionaryFromBytes(csv: Uint8Array, metadata: never): unknown
  TokenizerBuilder: new () => {
    setDictionaryInstance(d: unknown): unknown
    setUserDictionaryInstance(u: unknown): unknown
    setMode(mode: string): unknown
    setKeepWhitespace(keep: boolean): unknown
    build(): { tokenize(text: string): { surface: string; details: string[]; free?: () => void }[] }
  }
}

const DICT_FILES = [
  'metadata.json',
  'dict.trie',
  'dict.valsidx',
  'dict.vals',
  'dict.wordsidx',
  'dict.words',
  'matrix.mtx',
  'char_def.bin',
  'unk.bin',
] as const

const SPACE = /\s/u

/**
 * 解析器に渡す前に全角空白を半角に替える（COT-59）。IPADIC は全角空白を辞書に無い名詞として扱い、
 * 次の語の解析まで崩す（字下げの「　灯里ちゃん」で 灯 が接尾になる・「！　すぐ」の ！　 が1語の名詞になる）。
 * 1文字を1文字に替えるので、元の文字列の位置はずれない（toMorphTokens は元の文字列で位置を付ける）。
 */
export const forTokenizer = (text: string) => text.replace(/\u3000/gu, ' ')
const countChars = (text: string) => {
  let n = 0
  for (const ch of text) if (!SPACE.test(ch)) n++
  return n
}

export function classifyFailure(e: unknown): AnalyzerFailure {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  if (typeof WebAssembly === 'undefined' || typeof DecompressionStream === 'undefined') {
    return 'unsupported'
  }
  if (/memory|RangeError|out of bounds|allocation/iu.test(msg)) return 'memory'
  if (/fetch|network|Failed to fetch|NetworkError|offline/iu.test(msg)) return 'offline'
  return 'unknown'
}

export interface AnalyzerEngine {
  init(userDictCsv: string, excluded: ReadonlyArray<string>): Promise<void>
  analyze(
    episodes: ReadonlyArray<AnalyzeEpisode>,
    currentId: string,
    onProgress?: (done: number, total: number) => void,
  ): AnalysisResult
}

export function createAnalyzerEngine(
  lindera: LinderaLike,
  loadDictZip: () => Promise<Uint8Array>,
): AnalyzerEngine {
  let tokenizer: ReturnType<InstanceType<LinderaLike['TokenizerBuilder']>['build']> | null = null
  let excluded = new Set<string>()
  const cache = new Map<string, MorphToken[][]>()

  const tokenize = (text: string): RawToken[] => {
    if (!tokenizer) throw new Error('解析器の準備ができていません')
    const out: RawToken[] = []
    for (const t of tokenizer.tokenize(forTokenizer(text))) {
      out.push([t.surface, ...t.details])
      t.free?.()
    }
    return out
  }

  return {
    async init(userDictCsv, excludedTerms) {
      excluded = new Set(excludedTerms)
      cache.clear()
      const files = await unzipEntries(await loadDictZip(), new Set(DICT_FILES))
      const pick = (name: string) => {
        const f = files.get(name)
        if (!f) throw new Error(`辞書に ${name} がありません`)
        return f
      }
      const dict = lindera.loadDictionaryFromBytes(...DICT_FILES.map(pick))
      const builder = new lindera.TokenizerBuilder()
      // ユーザー辞書は、辞書を builder に渡す前に作る（渡した後は metadata が読めない）
      if (userDictCsv) {
        const user = lindera.loadUserDictionaryFromBytes(
          new TextEncoder().encode(userDictCsv),
          dict.metadata as never,
        )
        builder.setUserDictionaryInstance(user)
      }
      builder.setDictionaryInstance(dict)
      builder.setMode('normal')
      builder.setKeepWhitespace(true)
      tokenizer = builder.build()
    },

    analyze(episodes, currentId, onProgress) {
      const blocksOfWork: MorphToken[][] = []
      const nameSources: NameSourceEpisode[] = []
      let current: MorphToken[][] = []
      let totalChars = 0
      let currentChars = 0
      const endingCounts = emptyEndingCounts()
      let endingRuns = 0
      const seen = new Set<string>()
      episodes.forEach((ep, i) => {
        const key = `${ep.id}:${ep.hash}`
        seen.add(key)
        let tokens = cache.get(key)
        if (!tokens) {
          tokens = ep.texts.map((t) => (t.trim() ? toMorphTokens(tokenize(t), t) : []))
          cache.set(key, tokens)
        }
        blocksOfWork.push(...tokens)
        nameSources.push({ texts: ep.texts, tokens, rubies: ep.rubies, refs: ep.refs })
        const chars = ep.texts.reduce((sum, t) => sum + countChars(t), 0)
        if (ep.id === currentId) {
          current = tokens
          currentChars = chars
        }
        totalChars += chars
        const ends = sentenceEndings(ep.texts, tokens)
        for (const k of ENDING_KINDS) endingCounts[k] += ends.counts[k]
        endingRuns += ends.runs.length
        onProgress?.(i + 1, episodes.length)
      })
      for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
      return {
        currentTokens: current,
        workVariants: countAutoVariants(blocksOfWork, excluded),
        frequent: frequentWords(blocksOfWork, totalChars, excluded),
        frequentCurrent: frequentWords(current, currentChars, excluded),
        conjunctions: frequentWords(blocksOfWork, totalChars, excluded, 5, 'conjunction'),
        conjunctionsCurrent: frequentWords(current, currentChars, excluded, 5, 'conjunction'),
        endings: { counts: endingCounts, runs: endingRuns },
        names: findNameCandidates(nameSources, excluded, (base, reading) => {
          // ルビの親文字が辞書の1語で、読みがルビと同じなら読み仮名（候補にしない）
          const t = toMorphTokens(tokenize(base), base)
          return (
            t.length === 1 &&
            t[0] !== undefined &&
            !isUnknownToken(t[0]) &&
            t[0].reading === reading
          )
        }),
      }
    },
  }
}

/** 段落テキストの軽いハッシュ（FNV-1a 32bit）。話が変わったかの判定にだけ使う。 */
export function textsHash(texts: ReadonlyArray<string>): string {
  let h = 0x811c9dc5
  for (const t of texts) {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x0a
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${texts.length}`
}
