import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work, WorkFormat } from '../schema'

export interface ImportedEpisodeInput {
  title: string
  /** normalize 済みの本文（なろう／カクヨム記法のまま）。 */
  body: string
}

export interface ImportedWorkInput {
  title: string
  author?: string
  /** 作品の形式。脚本のときだけ印を付ける（小説は欄を持たない＝新しい作品の作成と同じ）。 */
  format?: WorkFormat
  episodes: readonly ImportedEpisodeInput[]
}

/**
 * 取り込み結果から新しい Work を組み立てる。スキーマは既存の WorkSchema の範囲（脚本のときだけ format を付ける）。
 * 空タイトルは「第N話」で補い、本文は末尾の空行を落としてから parseEpisodeBody に通す。
 */
export function buildImportedWork(
  input: ImportedWorkInput,
  genId: () => string,
  now: () => number,
): Work {
  const author = input.author?.trim()
  return {
    id: genId(),
    title: input.title,
    episodes: input.episodes.map((e, i) => ({
      id: genId(),
      title: e.title.trim() === '' ? `第${i + 1}話` : e.title,
      blocks: parseEpisodeBody(e.body.replace(/\n+$/, '')),
    })),
    updatedAt: now(),
    ...(author ? { author } : {}),
    ...(input.format === 'script' ? { format: 'script' as const } : {}),
  }
}
