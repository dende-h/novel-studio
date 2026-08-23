import { z } from 'zod'

/**
 * 構造レイヤー（アウトライン／相関図／マインドマップ）の共通データモデル。
 * 3ビューは同じ「器」（ノード＋エッジ＋階層）を共有し、用途別に別インスタンスで持つ。
 * ノードの kind と参照（glossaryRef／episodeRef）が用語集・本文との結合点になる。
 */

/** ノード1個。kind で意味づけし、参照フィールドで用語集・本文と結ぶ。 */
export const StructureNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['scene', 'character', 'idea', 'place', 'note']),
  label: z.string(),
  /** メモ本文。 */
  note: z.string().optional(),
  /** ノードの色（マインドマップの色分け用。トークン名 or 未設定＝既定）。 */
  color: z.string().optional(),
  /** 用語集エントリID（相関図キャラ＝用語集と同一実体）。 */
  glossaryRef: z.string().optional(),
  /** 本文の話ID（アウトライン＝本文と双方向同期）。 */
  episodeRef: z.string().optional(),
  /** 親ノードID（アウトラインの階層用）。 */
  parentId: z.string().optional(),
  /** 配置（相関図・マインドマップ用）。 */
  x: z.number().optional(),
  y: z.number().optional(),
  /** マインドマップで中心から見た向き（'l'=左, 'r'=右）。枝はこの向きへ伸びる。 */
  side: z.enum(['l', 'r']).optional(),
})
export type StructureNode = z.infer<typeof StructureNodeSchema>

/** ノード間の辺。相関図の関係、アウトラインの順序、マインドマップの連想。 */
export const StructureEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  kind: z.enum(['relation', 'sequence', 'association']),
  /** 接続元の辺（相関図で上下左右どこから出たか。't'|'r'|'b'|'l'）。 */
  fromHandle: z.string().optional(),
  /** 接続先の辺（相関図で上下左右どこへ入ったか）。 */
  toHandle: z.string().optional(),
})
export type StructureEdge = z.infer<typeof StructureEdgeSchema>

/** 構造インスタンスの種別。 */
export const StructureKindSchema = z.enum(['outline', 'chart', 'mindmap'])
export type StructureKind = z.infer<typeof StructureKindSchema>

/** 1つの構造インスタンス。作品(workId)に紐づく。 */
export const StructureSchema = z.object({
  id: z.string(),
  workId: z.string(),
  kind: StructureKindSchema,
  /** 表示名（マインドマップを複数持つとき等に使う）。 */
  title: z.string().optional(),
  nodes: z.array(StructureNodeSchema),
  edges: z.array(StructureEdgeSchema),
  updatedAt: z.number(),
})
export type Structure = z.infer<typeof StructureSchema>

/**
 * ビューが自動生成する singleton 構造（作品×種別で 1 つ）の決定的 id。
 * ランダム id で自動生成すると、同期の pull が届く前に複数端末が別々の空構造を作って
 * 増殖し、「いちばん新しい空の方」が表示されて内容が消えたように見える（stg 実機で判明）。
 * id を workId:kind に固定すれば、どの端末が作っても同じレコードに収束する。
 */
export function singletonStructureId(workId: string, kind: StructureKind): string {
  return `${workId}:${kind}`
}

/**
 * 中身が無い（＝同期レースで自動生成されただけの）構造か。
 * マインドマップは初期化で空ラベルの中心ノードを 1 つ足すので、それも「中身なし」に含める。
 */
export function isTrivialStructure(s: Structure): boolean {
  if (s.edges.length > 0) return false
  const only = s.nodes.length === 1 ? s.nodes[0] : undefined
  if (s.nodes.length === 0) return true
  return only !== undefined && only.label.trim() === '' && !only.note?.trim()
}

/**
 * 同種の構造が複数あるとき、表示すべき 1 つを選ぶ（純関数）。
 * 中身あり優先 → 内容量（ノード＋エッジ数） → updatedAt の新しい方 → id 昇順で決定的に。
 * updatedAt だけで選ぶと、同期レースで生まれた「新しくて空」が勝って内容が消えたように見えるため、
 * 内容を持つ方を常に優先する。
 */
export function pickPrimaryStructure(
  list: Structure[],
  kind: StructureKind,
): Structure | undefined {
  const candidates = list.filter((s) => s.kind === kind)
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => {
    const aTrivial = isTrivialStructure(a) ? 1 : 0
    const bTrivial = isTrivialStructure(b) ? 1 : 0
    if (aTrivial !== bTrivial) return aTrivial - bTrivial // 中身ありが先
    const weight = (s: Structure) => s.nodes.length + s.edges.length
    if (weight(a) !== weight(b)) return weight(b) - weight(a)
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : 1
  })[0]
}

/** 空の構造を組み立てる（純関数）。永続化は Repository 側で行う。 */
export function emptyStructure(
  id: string,
  workId: string,
  kind: StructureKind,
  at: number,
  title?: string,
): Structure {
  return {
    id,
    workId,
    kind,
    ...(title ? { title } : {}),
    nodes: [],
    edges: [],
    updatedAt: at,
  }
}

/** ノードを追加する（イミュータブル）。 */
export function addNode(s: Structure, node: StructureNode): Structure {
  return { ...s, nodes: [...s.nodes, node] }
}

/** ノードのフィールドを部分更新する（id は不変）。 */
export function updateNode(
  s: Structure,
  id: string,
  patch: Partial<Omit<StructureNode, 'id'>>,
): Structure {
  return { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
}

/** ノードを削除する。そのノードに繋がるエッジも一緒に削除する。 */
export function removeNode(s: Structure, id: string): Structure {
  return {
    ...s,
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.from !== id && e.to !== id),
  }
}

/** エッジを追加する。 */
export function addEdge(s: Structure, edge: StructureEdge): Structure {
  return { ...s, edges: [...s.edges, edge] }
}

/** エッジを削除する。 */
export function removeEdge(s: Structure, id: string): Structure {
  return { ...s, edges: s.edges.filter((e) => e.id !== id) }
}
