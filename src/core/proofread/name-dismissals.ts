import { z } from 'zod'

/**
 * 推敲画面の「用語集に無い名前」で、作者が候補から外した語（COT-59 FR-5）。
 * 作品ごとに1件。作品と一緒に同期・バックアップする（推敲の判断と同じ相乗り・LWW）。
 * 新設なので核の欄（workId・updatedAt・text・at）は必須。今後足す欄は optional にする。
 * 消すのは「戻す」と作品の完全削除だけ（本文から語が無くなっても残す）。
 */
export const NameDismissalSchema = z.object({
  text: z.string(),
  /** 外した時刻（並べ替えと、将来の語ごとのマージに使う）。 */
  at: z.number(),
})
export type NameDismissal = z.infer<typeof NameDismissalSchema>

export const NameDismissalsSchema = z.object({
  workId: z.string(),
  words: z.array(NameDismissalSchema).optional().default([]),
  /** 同期の LWW に使う（ProofreadRecordSchema と同じ）。 */
  updatedAt: z.number(),
})
export type NameDismissals = z.infer<typeof NameDismissalsSchema>

/** 外した語の集合（表示の絞り込み用）。記録が無ければ空。 */
export function dismissedSet(record: NameDismissals | undefined): ReadonlySet<string> {
  return new Set((record?.words ?? []).map((w) => w.text))
}

/** 語を外す。もう外してあれば記録を変えない（同じ参照を返す）。 */
export function dismissName(
  record: NameDismissals | undefined,
  workId: string,
  text: string,
  now: number,
): NameDismissals {
  const words = record?.words ?? []
  if (record && words.some((w) => w.text === text)) return record
  return { workId, words: [...words, { text, at: now }], updatedAt: now }
}

/** 外した語を戻す（記録から消す）。外していなければ記録を変えない。 */
export function restoreName(record: NameDismissals, text: string, now: number): NameDismissals {
  if (!record.words.some((w) => w.text === text)) return record
  return { ...record, words: record.words.filter((w) => w.text !== text), updatedAt: now }
}
