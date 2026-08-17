import type { Episode } from '../schema'
import { countEpisodeChars } from '../stats'
import type { Structure, StructureNode } from '../structure'

/**
 * アウトライン（構造レイヤー kind:outline）の派生ロジック。
 * 話(episode)は本文と双方向同期するライブビューなので、アウトライン側は「各話の進捗」と
 * 「各話にぶら下がる構成メモ（階層付きノード）」だけを扱う。純関数。
 *
 * 構成メモの階層は StructureNode.parentId で永続化し、操作は「深さ付きフラット列
 * （FlatNote[]）」の上で行う（アウトライナーの定石）。表示・編集・保存の流れ：
 * flattenNotes → indent/outdent/move/… → rebuildEpisodeNotes → repo.save。
 * parentId は保存時にフラット列の深さから導出する（親＝直前にある 1 段浅いメモ）。
 */

/** 話の執筆進捗（MVP：字数からの自動判定）。 */
export type EpisodeProgress = 'empty' | 'writing'

/** 話の字数から進捗を判定する（0字＝未着手、それ以上＝執筆中）。 */
export function progressOf(chars: number): EpisodeProgress {
  return chars <= 0 ? 'empty' : 'writing'
}

/** 構成メモのフラット表現。depth 0 が最上位。列の順序＝表示順（DFS）。 */
export interface FlatNote {
  id: string
  label: string
  depth: number
}

/** 階層の最大深さ（0 起点で 0..2 ＝ 3 段）。UI が壊れず用途に足る上限。 */
export const MAX_NOTE_DEPTH = 2

/** 話1件ぶんのアウトライン行（本文由来＋構成メモ）。 */
export interface OutlineRow {
  episodeId: string
  title: string
  chars: number
  progress: EpisodeProgress
  /** この話にぶら下がる構成メモ（深さ付き・表示順）。 */
  notes: FlatNote[]
}

/**
 * outline 構造から、指定した話の構成メモを深さ付きフラット列にする。
 * parentId が壊れている（存在しない・他の話を指す）メモは最上位として救済する
 * （同期のマージや旧バージョンとの併用でも黙って消えないように）。
 */
export function flattenNotes(outline: Structure | null, episodeId: string): FlatNote[] {
  const notes = (outline?.nodes ?? []).filter((n) => n.episodeRef === episodeId)
  const byParent = new Map<string, StructureNode[]>()
  const ids = new Set(notes.map((n) => n.id))
  const roots: StructureNode[] = []
  for (const n of notes) {
    if (n.parentId && ids.has(n.parentId) && n.parentId !== n.id) {
      const arr = byParent.get(n.parentId) ?? []
      arr.push(n)
      byParent.set(n.parentId, arr)
    } else {
      roots.push(n)
    }
  }
  const out: FlatNote[] = []
  const visited = new Set<string>()
  const walk = (n: StructureNode, depth: number) => {
    if (visited.has(n.id)) return // 循環 parentId の防御
    visited.add(n.id)
    out.push({ id: n.id, label: n.label, depth: Math.min(depth, MAX_NOTE_DEPTH) })
    for (const c of byParent.get(n.id) ?? []) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
}

/**
 * フラット列を outline 構造へ書き戻す（当該話のメモを丸ごと置き換え）。
 * parentId は「直前にある 1 段浅いメモ」から導出する。既存ノードの他フィールド
 * （note・color 等）は id で引き継ぐ。他の話のメモ・他種ノードには触れない。
 */
export function rebuildEpisodeNotes(
  outline: Structure,
  episodeId: string,
  flat: FlatNote[],
): Structure {
  const prev = new Map(outline.nodes.map((n) => [n.id, n]))
  const others = outline.nodes.filter((n) => n.episodeRef !== episodeId)
  // 深さ→直近のそのノード id。親の導出用スタック。
  const lastAtDepth: string[] = []
  const rebuilt: StructureNode[] = flat.map((f) => {
    const depth = Math.max(0, Math.min(f.depth, MAX_NOTE_DEPTH, lastAtDepth.length))
    const base = prev.get(f.id)
    lastAtDepth.length = depth + 1
    lastAtDepth[depth] = f.id
    return {
      ...base,
      id: f.id,
      kind: 'note',
      label: f.label,
      episodeRef: episodeId,
      parentId: depth > 0 ? lastAtDepth[depth - 1] : undefined,
    }
  })
  return { ...outline, nodes: [...others, ...rebuilt] }
}

/** id の位置と、そのサブツリー（自分＋自分より深い連続区間）の終端（排他）を返す。 */
function subtreeRange(flat: FlatNote[], id: string): { start: number; end: number } | null {
  const start = flat.findIndex((f) => f.id === id)
  if (start < 0) return null
  let end = start + 1
  while (end < flat.length && (flat[end]?.depth ?? 0) > (flat[start]?.depth ?? 0)) end++
  return { start, end }
}

/** 直前の兄弟（同じ深さで、間により浅いメモを挟まない）の位置。無ければ -1。 */
function prevSiblingIndex(flat: FlatNote[], start: number): number {
  const d = flat[start]?.depth ?? 0
  for (let i = start - 1; i >= 0; i--) {
    const di = flat[i]?.depth ?? 0
    if (di < d) return -1
    if (di === d) return i
  }
  return -1
}

/** 1 段下げる（直前の兄弟の子になる）。できない（先頭・上限超過）なら null。 */
export function indentNote(flat: FlatNote[], id: string): FlatNote[] | null {
  const range = subtreeRange(flat, id)
  if (!range) return null
  if (prevSiblingIndex(flat, range.start) < 0) return null // ぶら下がる先が無い
  const deepest = Math.max(...flat.slice(range.start, range.end).map((f) => f.depth))
  if (deepest + 1 > MAX_NOTE_DEPTH) return null
  return flat.map((f, i) => (i >= range.start && i < range.end ? { ...f, depth: f.depth + 1 } : f))
}

/** 1 段上げる。最上位なら null。（後続の旧兄弟は自分の子になる＝アウトライナーの定石） */
export function outdentNote(flat: FlatNote[], id: string): FlatNote[] | null {
  const range = subtreeRange(flat, id)
  if (!range || (flat[range.start]?.depth ?? 0) === 0) return null
  return flat.map((f, i) => (i >= range.start && i < range.end ? { ...f, depth: f.depth - 1 } : f))
}

/** 兄弟間で上下へ動かす（サブツリーごと）。端なら null。 */
export function moveNote(flat: FlatNote[], id: string, dir: -1 | 1): FlatNote[] | null {
  const range = subtreeRange(flat, id)
  if (!range) return null
  if (dir === -1) {
    const prev = prevSiblingIndex(flat, range.start)
    if (prev < 0) return null
    return [
      ...flat.slice(0, prev),
      ...flat.slice(range.start, range.end),
      ...flat.slice(prev, range.start),
      ...flat.slice(range.end),
    ]
  }
  // 下へ：直後が同じ深さの兄弟のときだけ、その兄弟サブツリーの後ろへ回る。
  const next = flat[range.end]
  if (!next || next.depth !== (flat[range.start]?.depth ?? 0)) return null
  const nextRange = subtreeRange(flat, next.id)
  if (!nextRange) return null
  return [
    ...flat.slice(0, range.start),
    ...flat.slice(nextRange.start, nextRange.end),
    ...flat.slice(range.start, range.end),
    ...flat.slice(nextRange.end),
  ]
}

/** 削除。子は消さず 1 段昇格させる（誤削除で下位構成が丸ごと消えない）。 */
export function removeNoteAt(flat: FlatNote[], id: string): FlatNote[] | null {
  const range = subtreeRange(flat, id)
  if (!range) return null
  return [
    ...flat.slice(0, range.start),
    ...flat
      .slice(range.start + 1, range.end)
      .map((f) => ({ ...f, depth: Math.max(0, f.depth - 1) })),
    ...flat.slice(range.end),
  ]
}

/** ラベル（本文）を書き換える。空文字は呼び出し側で弾く（削除は明示操作のみ）。 */
export function setNoteLabel(flat: FlatNote[], id: string, label: string): FlatNote[] {
  return flat.map((f) => (f.id === id ? { ...f, label } : f))
}

/** 末尾に追加。depth は「最後のメモの深さ+1」と MAX_NOTE_DEPTH に収める。 */
export function appendNote(flat: FlatNote[], id: string, label: string, depth: number): FlatNote[] {
  const last = flat[flat.length - 1]
  const max = Math.min(last ? last.depth + 1 : 0, MAX_NOTE_DEPTH)
  return [...flat, { id, label, depth: Math.max(0, Math.min(depth, max)) }]
}

/**
 * 本文の話一覧と outline 構造から、アウトライン表示用の行を組む。
 * 行の順序は本文の話順（＝双方向同期の真実）。構成メモは episodeRef で各話に振り分ける。
 */
export function buildOutlineRows(episodes: Episode[], outline: Structure | null): OutlineRow[] {
  return episodes.map((ep) => {
    const chars = countEpisodeChars(ep)
    return {
      episodeId: ep.id,
      title: ep.title,
      chars,
      progress: progressOf(chars),
      notes: flattenNotes(outline, ep.id),
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
