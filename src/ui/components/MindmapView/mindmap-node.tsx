import { Handle, type NodeProps, Position } from '@xyflow/react'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'

/** マインドマップの操作をノードへ渡すコンテキスト（＋で子を生やす・入力・削除）。 */
export interface MindmapActions {
  onLabelChange: (id: string, label: string) => void
  /** 指定した向き（'l'|'r'）へ子ノードを生やす。 */
  onAddChild: (id: string, side: 'l' | 'r') => void
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
  /** 伸びる向き（-1=左, 0=中心, 1=右）。＋ボタンの左右に使う。 */
  dir?: number
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
  const dir = typeof d.dir === 'number' ? d.dir : 0
  const isRoot = depth === 0
  // 中心は左右どちらへも伸ばせる。枝ノードは自分の向きへのみ伸ばす。
  const mySide: 'l' | 'r' = dir < 0 ? 'l' : 'r'
  // 入力はローカル state で保持し、外部の再レンダーでカーソルが飛ばないようにする。
  const [text, setText] = useState(d.label)
  // ⋯ メニュー（削除など）。＋ボタンと離し、削除は2ステップにして誤操作を防ぐ。
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ctx?.focusId === id) inputRef.current?.focus()
  }, [ctx?.focusId, id])

  // メニュー外のクリックで閉じる（開いた瞬間のクリックで閉じないよう次ティックで登録）。
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', close)
    }
  }, [menuOpen])

  return (
    <div className="group relative">
      {/* 左右どちらへも繋げられるよう、両側に source/target を用意（不可視）。辺側で選ぶ。 */}
      <Handle id="tgt-l" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="src-l" type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="tgt-r" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="src-r" type="source" position={Position.Right} style={{ opacity: 0 }} />

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
            // Enter で子を生やす（中心は右へ、枝は自分の向きへ）。RF のショートカットを奪われないよう伝播を止める。
            if (e.key === 'Enter') {
              e.preventDefault()
              ctx?.onAddChild(id, mySide)
            }
            e.stopPropagation()
          }}
          placeholder={isRoot ? '中心のテーマ' : '入力…'}
          className={`nodrag nopan w-full bg-transparent text-center ${tier.font} ${isRoot ? 'font-semibold' : ''} text-on-surface outline-none placeholder:text-on-surface-variant/45`}
        />
      </div>

      {/* ＋：中心は左右の両方、枝は自分の向きだけ。hover / フォーカスで出現。 */}
      {isRoot || mySide === 'r' ? (
        <button
          type="button"
          aria-label="右へ子ノードを追加"
          onClick={() => ctx?.onAddChild(id, 'r')}
          className="nodrag nopan -right-3 -translate-y-1/2 absolute top-1/2 grid size-6 place-items-center rounded-full bg-primary text-white opacity-0 shadow-sm transition-opacity hover:bg-primary/90 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
      {isRoot || mySide === 'l' ? (
        <button
          type="button"
          aria-label="左へ子ノードを追加"
          onClick={() => ctx?.onAddChild(id, 'l')}
          className="nodrag nopan -left-3 -translate-y-1/2 absolute top-1/2 grid size-6 place-items-center rounded-full bg-primary text-white opacity-0 shadow-sm transition-opacity hover:bg-primary/90 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}

      {/* ⋯ メニュー：枠外・上部中央（＋は左右なので離れている）。開いた先の「削除」で消す＝2ステップで誤操作防止。 */}
      <div className="-top-3.5 -translate-x-1/2 absolute left-1/2 z-10 flex flex-col items-center">
        <button
          type="button"
          aria-label="ノードのメニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`nodrag nopan grid size-5 place-items-center rounded-full border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant shadow-sm transition-opacity hover:text-on-surface ${
            menuOpen
              ? 'opacity-100'
              : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
        {menuOpen ? (
          <div className="absolute bottom-full mb-1 flex flex-col overflow-hidden rounded-md border border-outline-variant/40 bg-surface-container-lowest shadow-md">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                ctx?.onDelete(id)
              }}
              className="nodrag nopan flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[12px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              削除
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** React Flow に渡す nodeTypes（マインドマップ専用）。 */
export const MINDMAP_NODE_TYPES = { mindmap: MindmapNode }
