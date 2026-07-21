import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react'
import { X } from 'lucide-react'
import { useContext } from 'react'
import { StructureCanvasContext } from '@/ui/structure/structure-canvas-context'

/**
 * 相関図の辺。中点に関係ラベルを表示し、hover で削除ボタン（×）を出す。
 * 上下左右どこに繋いでも、その端点間をベジェで結ぶ。
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const ctx = useContext(StructureCanvasContext)

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="group/edge nodrag nopan absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          {label ? (
            <span className="rounded-full border border-outline-variant/40 bg-surface-container-lowest px-2 py-0.5 font-sans text-[11px] text-on-surface-variant shadow-sm">
              {label}
            </span>
          ) : (
            <span className="size-2 rounded-full bg-outline-variant/50 transition-opacity group-hover/edge:opacity-0" />
          )}
          <button
            type="button"
            aria-label="この線を削除"
            onClick={() => ctx?.onDeleteEdge(id)}
            className="grid size-4 place-items-center rounded-full bg-destructive text-white opacity-0 shadow-sm transition-opacity group-hover/edge:opacity-100"
          >
            <X className="size-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/** React Flow に渡す edgeTypes（相関図の削除可能な辺）。 */
export const STRUCTURE_EDGE_TYPES = { deletable: DeletableEdge }
