import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work } from '../schema'

export interface ImportedEpisodeInput {
  title: string
  /** normalize 済みの本文（なろう／カクヨム記法のまま）。 */
  body: string
}

export interface ImportedWorkInput {
  title: string
  author?: string
  episodes: readonly ImportedEpisodeInput[]
}

/**
 * 取り込み結果から新しい Work を組み立てる。スキーマは既存の WorkSchema の範囲（format は付けない＝小説）。
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
  }
}
