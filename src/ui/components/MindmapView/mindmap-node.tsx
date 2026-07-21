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
  /** 階層（0=中心）。フォント段階・幅・見た目に使う。 */
  depth?: number
  [key: string]: unknown
}

/** 中心/第2/第3以降の3段階（フォント・幅・余白・見た目）。 */
const TIER = [
  {
    font: 'text-[16px]',
    width: 'w-[190px]',
    pad: 'px-4 py-2.5',
    box: 'border-primary/45 bg-primary/5',
  },
  {
    font: 'text-[13.5px]',
    width: 'w-[168px]',
    pad: 'px-3 py-2',
    box: 'border-outline-variant/45 bg-surface-container-lowest',
  },
  {
    font: 'text-[11.5px]',
    width: 'w-[148px]',
    pad: 'px-2.5 py-1.5',
    box: 'border-outline-variant/35 bg-surface-container-lowest',
  },
] as const

/**
 * マインドマップのノード。ラベルは直接入力、右端の＋で子ノードを生やす。
 * ドラッグはしない（配置は自動）。階層で文字サイズが 3 段階（中心が最大）。
 */
function MindmapNode({ id, data }: NodeProps) {
  const ctx = useContext(MindmapContext)
  const d = data as MindmapNodeData
  const depth = typeof d.depth === 'number' ? d.depth : 0
  const tier = TIER[Math.min(depth, 2)] ?? TIER[1]
  // 入力はローカル state で保持し、外部の再レンダーでカーソルが飛ばないようにする。
  const [text, setText] = useState(d.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ctx?.focusId === id) inputRef.current?.focus()
  }, [ctx?.focusId, id])

  return (
    <div className="group relative">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div
        className={`${tier.width} ${tier.pad} ${tier.box} rounded-xl border shadow-sm transition-shadow focus-within:border-primary/60 focus-within:shadow-md`}
      >
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
          placeholder={depth === 0 ? '中心のテーマ' : '入力…'}
          className={`nodrag nopan w-full bg-transparent text-center ${tier.font} ${depth === 0 ? 'font-semibold' : ''} text-on-surface outline-none placeholder:text-on-surface-variant/45`}
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

      {/* 削除：hover で出現。子孫ごと消える（どのノードでも可）。 */}
      <button
        type="button"
        aria-label="このノードを削除"
        onClick={() => ctx?.onDelete(id)}
        className="nodrag nopan -top-2 -right-2 absolute grid size-5 place-items-center rounded-full bg-surface-container-high text-on-surface-variant opacity-0 shadow-sm transition-opacity hover:text-on-surface group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

/** React Flow に渡す nodeTypes（マインドマップ専用）。 */
export const MINDMAP_NODE_TYPES = { mindmap: MindmapNode }
