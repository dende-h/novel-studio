import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, GlossaryEntry, Work } from '../schema'
import { type Structure, StructureSchema } from '../structure'

/**
 * MCP 書き込みの純ロジック。作品配列・構造配列に対する編集をイミュータブルに行う。
 * 見つからない等のドメインエラーは McpEditError（ツール側が isError で返す）。R2/暗号化に非依存。
 */

export class McpEditError extends Error {}

/** 空文字は未設定(undefined)へ畳む（スキーマの任意項目を綺麗に保つ）。 */
const emptyToUndef = (s: string | undefined): string | undefined =>
  s === undefined || s.trim() === '' ? undefined : s

function updateWork(works: Work[], workId: string, fn: (w: Work) => Work): Work[] {
  let found = false
  const next = works.map((w) => {
    if (w.id !== workId) return w
    found = true
    return fn(w)
  })
  if (!found) throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  return next
}

/** 作品のメタ（タイトル・著者・あらすじ）を更新する。 */
export function setWorkMeta(
  works: Work[],
  workId: string,
  patch: { title?: string; author?: string; description?: string },
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => ({
    ...w,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.author !== undefined ? { author: emptyToUndef(patch.author) } : {}),
    ...(patch.description !== undefined ? { description: emptyToUndef(patch.description) } : {}),
    updatedAt: now,
  }))
}

/** 話のタイトル・本文（プレーンテキスト→記法解析）を更新する。 */
export function setEpisode(
  works: Work[],
  workId: string,
  episodeId: string,
  patch: { title?: string; body?: string },
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => {
    let found = false
    const episodes = w.episodes.map((ep) => {
      if (ep.id !== episodeId) return ep
      found = true
      return {
        ...ep,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { blocks: parseEpisodeBody(patch.body) } : {}),
      }
    })
    if (!found) throw new McpEditError(`episode_id "${episodeId}" の話が見つかりません`)
    return { ...w, episodes, updatedAt: now }
  })
}

/** 話を新規追加する。作成した episodeId も返す。 */
export function addEpisode(
  works: Work[],
  workId: string,
  input: { title: string; body?: string },
  episodeId: string,
  now: number,
): Work[] {
  const episode: Episode = {
    id: episodeId,
    title: input.title,
    blocks: input.body ? parseEpisodeBody(input.body) : [],
  }
  return updateWork(works, workId, (w) => ({
    ...w,
    episodes: [...w.episodes, episode],
    updatedAt: now,
  }))
}

/** 図鑑エントリを追加/更新（id 指定で更新、無ければ新規）。 */
export function upsertGlossaryEntry(
  works: Work[],
  workId: string,
  input: {
    id?: string
    name: string
    aliases?: string[]
    category?: string
    reading?: string
    summary?: string
    body?: string
  },
  newId: string,
  now: number,
): Work[] {
  const entryId = input.id ?? newId
  return updateWork(works, workId, (w) => {
    const glossary = w.glossary ?? []
    const prev = glossary.find((g) => g.id === entryId)
    const entry: GlossaryEntry = {
      id: entryId,
      name: input.name,
      aliases: input.aliases ?? [],
      ...(emptyToUndef(input.category) ? { category: input.category } : {}),
      ...(emptyToUndef(input.reading) ? { reading: input.reading } : {}),
      ...(emptyToUndef(input.summary) ? { summary: input.summary } : {}),
      ...(emptyToUndef(input.body) ? { body: input.body } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }
    const nextGlossary = prev
      ? glossary.map((g) => (g.id === entryId ? entry : g))
      : [...glossary, entry]
    return { ...w, glossary: nextGlossary, updatedAt: now }
  })
}

/** 図鑑エントリを削除する。 */
export function deleteGlossaryEntry(
  works: Work[],
  workId: string,
  entryId: string,
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => {
    const glossary = w.glossary ?? []
    if (!glossary.some((g) => g.id === entryId)) {
      throw new McpEditError(`entry_id "${entryId}" の図鑑項目が見つかりません`)
    }
    return { ...w, glossary: glossary.filter((g) => g.id !== entryId), updatedAt: now }
  })
}

/** 構造データ（JSON）を検証して Structure にする。不正なら McpEditError。 */
export function parseStructure(json: string): Structure {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new McpEditError('structure_json が JSON として解析できません')
  }
  const result = StructureSchema.safeParse(raw)
  if (!result.success) throw new McpEditError('structure_json が構造データの形式に合いません')
  return result.data
}

/** 構造データを追加/更新（id 一致で置換、無ければ追加）。 */
export function upsertStructure(structures: Structure[], structure: Structure): Structure[] {
  return structures.some((s) => s.id === structure.id)
    ? structures.map((s) => (s.id === structure.id ? structure : s))
    : [...structures, structure]
}
