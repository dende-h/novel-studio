import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
} from '@xyflow/react'
import { Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { NODE_COLOR_KEYS, NODE_COLORS, STRUCTURE_NODE_TYPES } from '@/ui/structure/structure-node'

interface StructureCanvasProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  /** ノードのラベルを変更する（ダブルクリック／編集ボタンから）。 */
  onRenameNode: (id: string, label: string) => void
  /** ノードの色を変更する。省略時は色パレットを出さない。 */
  onRecolorNode?: (id: string, color: string) => void
  /** ツールバー左に差し込むビュー固有のボタン群。 */
  toolbar?: ReactNode
}

/** 図鑑参照ノードは改名しても保存されない（ラベルは図鑑が真実）ので編集を抑止する。 */
const isGlossaryNode = (node: Node) => (node.data as { isGlossary?: unknown }).isGlossary === true

/**
 * 構造ビュー（マインドマップ・相関図）共通のキャンバス。
 * React Flow の描画に加え、選択ノードの色変更パレットとラベル編集を提供する。
 */
export function StructureCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onRenameNode,
  onRecolorNode,
  toolbar,
}: StructureCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const promptRename = useCallback(
    (node: Node) => {
      const current = (node.data as { label?: unknown }).label
      const label = window.prompt('ラベル', typeof current === 'string' ? current : '')
      if (label != null) onRenameNode(node.id, label)
    },
    [onRenameNode],
  )

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (!isGlossaryNode(node)) promptRename(node)
    },
    [promptRename],
  )

  return (
    <div className="relative h-full w-full">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">{toolbar}</div>

      {/* 選択中ノードの編集バー（色・改名）。図鑑参照ノードは色のみ、改名は無効時に隠す。 */}
      {selected ? (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md border border-outline-variant/40 bg-surface-container-lowest/95 px-2 py-1.5 shadow-sm backdrop-blur">
          {onRecolorNode ? (
            <div className="flex items-center gap-1">
              {NODE_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`色: ${key}`}
                  onClick={() => onRecolorNode(selected.id, key)}
                  style={{
                    background: NODE_COLORS[key]?.bg,
                    borderColor: NODE_COLORS[key]?.border,
                  }}
                  className="size-5 rounded-full border transition-transform hover:scale-110"
                />
              ))}
            </div>
          ) : null}
          {!isGlossaryNode(selected) ? (
            <button
              type="button"
              aria-label="ラベルを編集"
              onClick={() => promptRename(selected)}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-on-surface-variant text-xs hover:bg-surface-container-high"
            >
              <Pencil className="size-3.5" />
              名前
            </button>
          ) : null}
        </div>
      ) : null}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={STRUCTURE_NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
