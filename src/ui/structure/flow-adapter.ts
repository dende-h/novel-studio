import type { Edge, Node } from '@xyflow/react'
import type { Structure, StructureNode } from '@/core/structure'
import type { StructureNodeData } from './structure-node'

/**
 * Structure（コアのデータモデル）と React Flow の Node/Edge の相互変換。
 * 相関図・マインドマップの両ビューで共用する。純関数。
 * カスタムノード 'structure' を使い、data に kind・色・図鑑参照を載せて往復させる
 * （新規ノードでも glossaryRef/kind が失われないように data で持ち回る）。
 */

/** 図鑑参照の解決関数（相関図で使う）。id → ラベル文字列（見つからなければ null）。 */
export type ResolveGlossary = (id: string) => string | null

/** Structure のノードを React Flow の Node に変換する（位置未設定は原点）。 */
export function toFlowNodes(s: Structure, resolveGlossary?: ResolveGlossary): Node[] {
  return s.nodes.map((n) => {
    const isGlossary = n.glossaryRef != null
    const resolved = n.glossaryRef && resolveGlossary ? resolveGlossary(n.glossaryRef) : null
    const data: StructureNodeData = {
      label: resolved ?? n.label,
      kind: n.kind,
      ...(n.color ? { color: n.color } : {}),
      ...(n.glossaryRef ? { glossaryRef: n.glossaryRef } : {}),
      ...(isGlossary ? { isGlossary: true, refMissing: resolved == null } : {}),
    }
    return {
      id: n.id,
      type: 'structure',
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data,
    }
  })
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

/** ノードの data から文字列フィールドを安全に取り出す。空文字は fallback 扱い。 */
function strField(node: Node, key: string, fallback: string): string {
  const raw = (node.data as Record<string, unknown> | undefined)?.[key]
  return typeof raw === 'string' && raw !== '' ? raw : fallback
}

const KINDS: StructureNode['kind'][] = ['scene', 'character', 'idea', 'place', 'note']
function kindOf(node: Node, fallback: StructureNode['kind']): StructureNode['kind'] {
  const raw = (node.data as { kind?: unknown } | undefined)?.kind
  return KINDS.includes(raw as StructureNode['kind']) ? (raw as StructureNode['kind']) : fallback
}

/**
 * React Flow の現在状態を Structure に書き戻す。
 * kind・glossaryRef・色は data から拾い（新規ノードも保持）、note・episodeRef・parentId は base から引き継ぐ。
 */
export function fromFlow(base: Structure, nodes: Node[], edges: Edge[], at: number): Structure {
  const prevNodes = new Map(base.nodes.map((n) => [n.id, n]))
  const prevEdges = new Map(base.edges.map((e) => [e.id, e]))
  return {
    ...base,
    nodes: nodes.map((n): StructureNode => {
      const prev = prevNodes.get(n.id)
      const color = strField(n, 'color', prev?.color ?? '')
      const glossaryRef = strField(n, 'glossaryRef', prev?.glossaryRef ?? '')
      return {
        id: n.id,
        kind: kindOf(n, prev?.kind ?? 'idea'),
        label: strField(n, 'label', prev?.label ?? ''),
        ...(prev?.note ? { note: prev.note } : {}),
        ...(color ? { color } : {}),
        ...(glossaryRef ? { glossaryRef } : {}),
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
