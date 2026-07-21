import { z } from 'zod'

/**
 * 構造レイヤー（アウトライン／相関図／マインドマップ）の共通データモデル。
 * 3ビューは同じ「器」（ノード＋エッジ＋階層）を共有し、用途別に別インスタンスで持つ。
 * ノードの kind と参照（glossaryRef／episodeRef）が図鑑・本文との結合点になる。
 */

/** ノード1個。kind で意味づけし、参照フィールドで図鑑・本文と結ぶ。 */
export const StructureNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['scene', 'character', 'idea', 'place', 'note']),
  label: z.string(),
  /** メモ本文。 */
  note: z.string().optional(),
  /** ノードの色（マインドマップの色分け用。トークン名 or 未設定＝既定）。 */
  color: z.string().optional(),
  /** 図鑑エントリID（相関図キャラ＝図鑑と同一実体）。 */
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
