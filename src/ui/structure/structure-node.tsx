import { Handle, type NodeProps, Position } from '@xyflow/react'
import { BookMarked } from 'lucide-react'

interface Swatch {
  bg: string
  border: string
  text: string
}

/** ノードの色パレット（マインドマップの色分け）。キーを Structure に保存する。 */
export const NODE_COLORS: Record<string, Swatch> = {
  default: { bg: '#ffffff', border: '#c9bea9', text: '#2b2620' },
  forest: { bg: '#e7efe8', border: '#6f9a7f', text: '#21362b' },
  wheat: { bg: '#f6ecd8', border: '#c99a4f', text: '#6b4a12' },
  rose: { bg: '#f3e2df', border: '#c07d6c', text: '#5b2419' },
  sky: { bg: '#e0e9f1', border: '#6f92b4', text: '#1f3350' },
  plum: { bg: '#ece2f0', border: '#9a7db4', text: '#3a2450' },
}

export const NODE_COLOR_KEYS = Object.keys(NODE_COLORS)

/** カスタムノードの data 形。ラベル・色・図鑑参照の状態を持つ。 */
export interface StructureNodeData {
  label: string
  /** ノード種別（往復で保持）。 */
  kind?: string
  color?: string
  /** 図鑑エントリID（参照ノードの往復で保持）。 */
  glossaryRef?: string
  /** 図鑑参照ノードか（相関図で図鑑アバターや印を出す）。 */
  isGlossary?: boolean
  /** 図鑑参照が解決できない（削除済み等）。 */
  refMissing?: boolean
  [key: string]: unknown
}

const DEFAULT_SWATCH: Swatch = { bg: '#ffffff', border: '#c9bea9', text: '#2b2620' }
const swatch = (key?: string): Swatch => NODE_COLORS[key ?? 'default'] ?? DEFAULT_SWATCH

/**
 * 構造ビュー共通のカスタムノード。色分けと図鑑参照バッジに対応する。
 * ラベル編集はビュー側（ダブルクリック等）で行い、ここは表示に徹する。
 */
export function StructureFlowNode({ data, selected }: NodeProps) {
  const d = data as StructureNodeData
  const c = swatch(d.color)
  return (
    <div
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
      className={`min-w-[96px] max-w-[220px] rounded-lg border px-3 py-2 text-center font-sans text-[13px] leading-snug shadow-sm ${
        selected ? 'ring-2 ring-offset-1' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-center gap-1.5">
        {d.isGlossary ? (
          <BookMarked
            className="size-3.5 shrink-0 opacity-70"
            aria-label="図鑑のキャラ"
            style={{ color: d.refMissing ? '#9c4d33' : c.border }}
          />
        ) : null}
        <span className="break-words">{d.label || '（無題）'}</span>
      </div>
      {d.refMissing ? (
        <span className="mt-0.5 block text-[10px] text-[#9c4d33]">図鑑に見つかりません</span>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/** React Flow に渡す nodeTypes（両ビュー共通）。 */
export const STRUCTURE_NODE_TYPES = { structure: StructureFlowNode }
