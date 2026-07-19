import '@xyflow/react/dist/style.css'
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure } from '@/core/structure'
import { fromFlow, toFlowEdges, toFlowNodes } from '@/ui/structure/flow-adapter'

interface MindmapViewProps {
  repo: StructureRepository
  workId: string
}

const genId = () => crypto.randomUUID()

/** 変更を永続化するまでの静止時間(ms)。 */
const SAVE_DELAY_MS = 800

/**
 * マインドマップ（構造レイヤー kind:mindmap）。React Flow の無限キャンバスで
 * ノード追加・接続・配置し、変更を Structure に書き戻して永続化する。
 * バンドルが重いので default export とし、呼び出し側で遅延ロードする。
 */
export default function MindmapView({ repo, workId }: MindmapViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const baseRef = useRef<Structure | null>(null)
  const [ready, setReady] = useState(false)

  // 初期ロード：この作品の mindmap を取得（無ければ作成）。
  useEffect(() => {
    let alive = true
    void (async () => {
      const list = await repo.listByWork(workId)
      const mm =
        list.find((s) => s.kind === 'mindmap') ?? (await repo.create(workId, 'mindmap', '発想メモ'))
      if (!alive) return
      baseRef.current = mm
      setNodes(toFlowNodes(mm))
      setEdges(toFlowEdges(mm))
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [repo, workId, setNodes, setEdges])

  // 変更を静止後にまとめて永続化する。
  useEffect(() => {
    if (!ready || !baseRef.current) return
    const t = setTimeout(() => {
      const base = baseRef.current
      if (!base) return
      void repo.save(fromFlow(base, nodes, edges, Date.now())).then((saved) => {
        baseRef.current = saved
      })
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [nodes, edges, ready, repo])

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: genId() }, eds)),
    [setEdges],
  )

  const onAddNode = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: genId(),
        position: { x: 140 + (nds.length % 5) * 40, y: 100 + (nds.length % 5) * 40 },
        data: { label: '新しいノード' },
      },
    ])
  }, [setNodes])

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      const current = (node.data as { label?: unknown }).label
      const label = window.prompt('ノードのラベル', typeof current === 'string' ? current : '')
      if (label == null) return
      setNodes((nds) =>
        nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label } } : n)),
      )
    },
    [setNodes],
  )

  return (
    <div className="relative h-full w-full">
      <button
        type="button"
        onClick={onAddNode}
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-sans text-[13px] text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus className="size-4" />
        ノードを追加
      </button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
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
