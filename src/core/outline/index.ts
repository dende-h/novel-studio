import type { Episode } from '../schema'
import { countEpisodeChars } from '../stats'
import type { Structure, StructureNode } from '../structure'

/**
 * アウトライン（構造レイヤー kind:outline）の派生ロジック。
 * 話(episode)は本文と双方向同期するライブビューなので、アウトライン側は「各話の進捗」と
 * 「各話にぶら下がる構成メモ（子ノード）」だけを扱う。純関数。
 */

/** 話の執筆進捗（MVP：字数からの自動判定）。 */
export type EpisodeProgress = 'empty' | 'writing'

/** 話の字数から進捗を判定する（0字＝未着手、それ以上＝執筆中）。 */
export function progressOf(chars: number): EpisodeProgress {
  return chars <= 0 ? 'empty' : 'writing'
}

/** 話1件ぶんのアウトライン行（本文由来＋構成メモ数）。 */
export interface OutlineRow {
  episodeId: string
  title: string
  chars: number
  progress: EpisodeProgress
  /** この話にぶら下がる構成メモ（子ノード）。 */
  notes: StructureNode[]
}

/**
 * 本文の話一覧と outline 構造から、アウトライン表示用の行を組む。
 * 行の順序は本文の話順（＝双方向同期の真実）。構成メモは episodeRef で各話に振り分ける。
 */
export function buildOutlineRows(episodes: Episode[], outline: Structure | null): OutlineRow[] {
  const notesByEpisode = new Map<string, StructureNode[]>()
  for (const n of outline?.nodes ?? []) {
    if (n.parentId) continue // 子ノードのぶら下げは将来対応。MVP は話直下のメモのみ。
    if (!n.episodeRef) continue
    const arr = notesByEpisode.get(n.episodeRef) ?? []
    arr.push(n)
    notesByEpisode.set(n.episodeRef, arr)
  }
  return episodes.map((ep) => {
    const chars = countEpisodeChars(ep)
    return {
      episodeId: ep.id,
      title: ep.title,
      chars,
      progress: progressOf(chars),
      notes: notesByEpisode.get(ep.id) ?? [],
    }
  })
}

/** 全話の合計字数。 */
export function totalChars(rows: OutlineRow[]): number {
  return rows.reduce((n, r) => n + r.chars, 0)
}

/** 執筆に着手済み（字数>0）の話数。 */
export function writtenCount(rows: OutlineRow[]): number {
  return rows.filter((r) => r.progress === 'writing').length
}
