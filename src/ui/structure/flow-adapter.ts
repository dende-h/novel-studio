import type { Edge, Node } from '@xyflow/react'
import type { Structure, StructureNode } from '@/core/structure'

/**
 * Structure（コアのデータモデル）と React Flow の Node/Edge の相互変換。
 * 相関図・マインドマップの両ビューで共用する。純関数。
 */

/** Structure のノードを React Flow の Node に変換する（位置未設定は原点）。 */
export function toFlowNodes(s: Structure): Node[] {
  return s.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: { label: n.label },
  }))
}

/** Structure のエッジを React Flow の Edge に変換する。 */
export function toFlowEdges(s: Structure): Edge[] {
  return s.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    ...(e.label ? { label: e.label } : {}),
  }))
}

/** ノードの data.label を文字列として安全に取り出す。 */
function labelOf(node: Node, fallback: string): string {
  const raw = (node.data as { label?: unknown } | undefined)?.label
  return typeof raw === 'string' ? raw : fallback
}

/**
 * React Flow の現在状態を Structure に書き戻す。
 * kind・note・参照など React Flow が持たないフィールドは base から引き継ぐ。
 */
export function fromFlow(base: Structure, nodes: Node[], edges: Edge[], at: number): Structure {
  const prevNodes = new Map(base.nodes.map((n) => [n.id, n]))
  const prevEdges = new Map(base.edges.map((e) => [e.id, e]))
  return {
    ...base,
    nodes: nodes.map((n): StructureNode => {
      const prev = prevNodes.get(n.id)
      return {
        id: n.id,
        kind: prev?.kind ?? 'idea',
        label: labelOf(n, prev?.label ?? ''),
        ...(prev?.note ? { note: prev.note } : {}),
        ...(prev?.glossaryRef ? { glossaryRef: prev.glossaryRef } : {}),
        ...(prev?.episodeRef ? { episodeRef: prev.episodeRef } : {}),
        ...(prev?.parentId ? { parentId: prev.parentId } : {}),
        x: n.position.x,
        y: n.position.y,
      }
    }),
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      ...(e.label ? { label: String(e.label) } : {}),
      kind: prevEdges.get(e.id)?.kind ?? 'association',
    })),
    updatedAt: at,
  }
}
