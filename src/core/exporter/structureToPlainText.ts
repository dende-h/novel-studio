import type { GlossaryEntry, Work } from '../schema'
import { countEpisodeChars } from '../stats'
import type { Structure, StructureNode } from '../structure'

/**
 * 構造レイヤー（アウトライン・相関図・マインドマップ）→ AI が読めるプレーンテキスト。
 * read-only リモート MCP の `get_structures` ペイロード。図鑑参照は名前へ解決、
 * アウトラインは本文の話（順序・字数）に構成メモを添える。純ロジック。
 */

const KIND_ORDER: Record<Structure['kind'], number> = { outline: 0, chart: 1, mindmap: 2 }

/** 図鑑参照なら図鑑名、無ければノードのラベル。 */
function nodeLabel(n: StructureNode, glossary: GlossaryEntry[]): string {
  if (n.glossaryRef) {
    const g = glossary.find((x) => x.id === n.glossaryRef)
    if (g) return g.name
  }
  return n.label || '（無題）'
}

/** アウトライン：本文の話順に「話（字数）＋構成メモ」を並べる。 */
function outlineText(s: Structure, work: Work): string {
  const memosByEpisode = new Map<string, string[]>()
  for (const n of s.nodes) {
    // 話直下の構成メモ（episodeRef 付き・親なし）のみ拾う。
    if (n.episodeRef && !n.parentId) {
      const arr = memosByEpisode.get(n.episodeRef) ?? []
      if (n.label) arr.push(n.label)
      memosByEpisode.set(n.episodeRef, arr)
    }
  }
  const lines = work.episodes.map((ep, i) => {
    const head = `${i + 1}. ${ep.title || '無題の話'}（${countEpisodeChars(ep)}字）`
    const memos = memosByEpisode.get(ep.id) ?? []
    const sub = memos.map((m) => `   - ${m}`).join('\n')
    return sub ? `${head}\n${sub}` : head
  })
  return `【アウトライン】\n${lines.join('\n')}`
}

/** 相関図：登場人物一覧＋関係（from —（関係）→ to）。図鑑名で解決。 */
function chartText(s: Structure, glossary: GlossaryEntry[]): string {
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const rels = s.edges
    .map((e) => {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to) return null
      const rel = e.label ? `（${e.label}）` : ''
      return `- ${nodeLabel(from, glossary)} —${rel}→ ${nodeLabel(to, glossary)}`
    })
    .filter((x): x is string => x !== null)
  const names = s.nodes.map((n) => nodeLabel(n, glossary))
  const body = rels.length > 0 ? rels.join('\n') : '（関係の線はまだありません）'
  return `【相関図】\n登場人物: ${names.join('、')}\n${body}`
}

/** マインドマップ：parentId ツリーをインデントで表す。 */
function mindmapText(s: Structure): string {
  const children = new Map<string, StructureNode[]>()
  for (const n of s.nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n)
      children.set(n.parentId, arr)
    }
  }
  const lines: string[] = []
  const walk = (n: StructureNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${n.label || '（無題）'}`)
    for (const c of children.get(n.id) ?? []) walk(c, depth + 1)
  }
  for (const n of s.nodes) if (!n.parentId) walk(n, 0)
  const title = s.title ? `: ${s.title}` : ''
  return `【マインドマップ${title}】\n${lines.join('\n')}`
}

/**
 * 指定作品の構造データ（アウトライン・相関図・マインドマップ）を1ドキュメントにまとめる。
 * structures は全作品ぶんでよい（内部で work.id で絞る）。無ければ案内文を返す。
 */
export function structuresToPlainText(structures: Structure[], work: Work): string {
  const mine = structures
    .filter((s) => s.workId === work.id)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  if (mine.length === 0) {
    return '（この作品の構造データ（アウトライン・相関図・マインドマップ）はまだありません）'
  }
  const glossary = work.glossary ?? []
  const sections = mine
    .map((s) => {
      if (s.kind === 'outline') return outlineText(s, work)
      if (s.kind === 'chart') return chartText(s, glossary)
      return mindmapText(s)
    })
    .filter((t) => t.length > 0)
  return sections.join('\n\n')
}
