/**
 * Work を「doc（本文）」と「media（画像）」の 2 パートに分割／再結合する純ロジック（Phase 2）。
 *
 * R2 は doc/media の 2 オブジェクトに分けて保存し、変わった側だけを送る。
 * media の実体は Work 全体で `coverImage`（表紙）と `glossary[].thumbnail`（図鑑サムネ）
 * の data URL のみ（本文ブロックに画像は無い）。`joinWork(splitWork(w))` は w とロスレスに一致する。
 */

import type { GlossaryEntry, Work } from '../schema'

/** thumbnail を除いた図鑑エントリ（doc 側に入る）。 */
export type DocGlossaryEntry = Omit<GlossaryEntry, 'thumbnail'>

/** 画像を除いた Work（R2 の doc オブジェクトの中身）。 */
export type WorkDoc = Omit<Work, 'coverImage' | 'glossary'> & {
  glossary?: DocGlossaryEntry[]
}

/** Work の画像をまとめたもの（R2 の media オブジェクトの中身）。 */
export interface WorkMedia {
  /** 表紙画像（data URL）。 */
  coverImage?: string
  /** 図鑑エントリ id → サムネイル data URL。 */
  thumbnails: Record<string, string>
}

export interface SplitResult {
  doc: WorkDoc
  /** 画像が 1 枚も無ければ null（R2 に media オブジェクトを作らない）。 */
  media: WorkMedia | null
}

function stripThumbnail(entry: GlossaryEntry): DocGlossaryEntry {
  const { thumbnail: _thumbnail, ...rest } = entry
  return rest
}

/** Work を doc/media に分割する。 */
export function splitWork(work: Work): SplitResult {
  const { coverImage, glossary, ...rest } = work
  const doc: WorkDoc =
    glossary === undefined ? rest : { ...rest, glossary: glossary.map(stripThumbnail) }

  const thumbnails: Record<string, string> = {}
  if (glossary) {
    for (const entry of glossary) {
      if (entry.thumbnail !== undefined) {
        thumbnails[entry.id] = entry.thumbnail
      }
    }
  }
  const hasThumbnails = Object.keys(thumbnails).length > 0

  let media: WorkMedia | null = null
  if (coverImage !== undefined || hasThumbnails) {
    media = { thumbnails }
    if (coverImage !== undefined) {
      media.coverImage = coverImage
    }
  }
  return { doc, media }
}

/** doc/media から元の Work を復元する（splitWork の逆）。 */
export function joinWork(doc: WorkDoc, media: WorkMedia | null): Work {
  const { glossary, ...rest } = doc
  const work: Work = { ...rest }
  if (glossary !== undefined) {
    work.glossary = glossary.map((entry) => {
      const thumb = media?.thumbnails[entry.id]
      return thumb === undefined ? { ...entry } : { ...entry, thumbnail: thumb }
    })
  }
  if (media?.coverImage !== undefined) {
    work.coverImage = media.coverImage
  }
  return work
}
