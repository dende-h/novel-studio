import { Handle, type NodeProps, Position } from '@xyflow/react'
import { Plus, X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'

/** マインドマップの操作をノードへ渡すコンテキスト（＋で子を生やす・入力・削除）。 */
export interface MindmapActions {
  onLabelChange: (id: string, label: string) => void
  onAddChild: (id: string) => void
  onDelete: (id: string) => void
  /** 生やした直後に入力へフォーカスするノードID。 */
  focusId: string | null
}

export const MindmapContext = createContext<MindmapActions | null>(null)

interface MindmapNodeData {
  label: string
  isRoot?: boolean
  [key: string]: unknown
}

/**
 * マインドマップのノード。ラベルは直接入力、右端の＋で子ノードを生やす。
 * ドラッグはしない（配置は自動）。＋は hover/フォーカス時に現れる。
 */
function MindmapNode({ id, data }: NodeProps) {
  const ctx = useContext(MindmapContext)
  const d = data as MindmapNodeData
  // 入力はローカル state で保持し、外部の再レンダーでカーソルが飛ばないようにする。
  const [text, setText] = useState(d.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ctx?.focusId === id) inputRef.current?.focus()
  }, [ctx?.focusId, id])

  return (
    <div className="group relative">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div className="min-w-[128px] max-w-[240px] rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            ctx?.onLabelChange(id, e.target.value)
          }}
          onKeyDown={(e) => {
            // Enter で子を生やす。RF のショートカット（削除/パン）を奪われないよう伝播を止める。
            if (e.key === 'Enter') {
              e.preventDefault()
              ctx?.onAddChild(id)
            }
            e.stopPropagation()
          }}
          placeholder={d.isRoot ? '中心のテーマ' : '入力…'}
          className="nodrag nopan w-full bg-transparent text-center font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
        />
      </div>

      {/* ＋：右へ子ノードを生やす（hover / フォーカスで出現）。 */}
      <button
        type="button"
        aria-label="子ノードを追加"
        onClick={() => ctx?.onAddChild(id)}
        className="nodrag nopan -right-3 -translate-y-1/2 absolute top-1/2 grid size-6 place-items-center rounded-full bg-primary text-white opacity-0 shadow-sm transition-opacity hover:bg-primary/90 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <Plus className="size-3.5" />
      </button>

      {/* 削除：根以外、hover で出現。子孫ごと消える。 */}
      {!d.isRoot ? (
        <button
          type="button"
          aria-label="このノードを削除"
          onClick={() => ctx?.onDelete(id)}
          className="nodrag nopan -top-2 -right-2 absolute grid size-5 place-items-center rounded-full bg-surface-container-high text-on-surface-variant opacity-0 shadow-sm transition-opacity hover:text-on-surface group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

/** React Flow に渡す nodeTypes（マインドマップ専用）。 */
export const MINDMAP_NODE_TYPES = { mindmap: MindmapNode }
