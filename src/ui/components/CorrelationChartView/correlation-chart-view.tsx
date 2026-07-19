import { addEdge, type Connection, type Node } from '@xyflow/react'
import { Plus, UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { GlossaryEntry } from '@/core/schema'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { StructureCanvas } from '@/ui/components/StructureCanvas/structure-canvas'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { useStructureFlow } from '@/ui/structure/use-structure-flow'

interface CorrelationChartViewProps {
  repo: StructureRepository
  workId: string
  /** 図鑑エントリ一覧（参照ノードの解決・追加候補に使う）。 */
  glossary: GlossaryEntry[]
}

const genId = () => crypto.randomUUID()

/**
 * 相関図（構造レイヤー kind:chart）。図鑑のキャラを参照ノードにし、関係ラベル付きの辺で結ぶ。
 * 図鑑に無い端役は自由ノードで置ける。バンドルが重いので default export（遅延ロード）。
 */
export default function CorrelationChartView({
  repo,
  workId,
  glossary,
}: CorrelationChartViewProps) {
  const resolveGlossary = useCallback(
    (id: string) => glossary.find((g) => g.id === id)?.name ?? null,
    [glossary],
  )
  const flow = useStructureFlow(repo, workId, 'chart', { title: '相関図', resolveGlossary })
  const { nodes, setNodes, setEdges } = flow
  const [pickOpen, setPickOpen] = useState(false)

  // まだ相関図に載っていない図鑑キャラ。
  const usedRefs = useMemo(
    () =>
      new Set(nodes.map((n) => (n.data as { glossaryRef?: string }).glossaryRef).filter(Boolean)),
    [nodes],
  )
  const candidates = glossary.filter((g) => !usedRefs.has(g.id))

  const onConnect = useCallback(
    (c: Connection) => {
      const label = window.prompt('関係（例：師弟、宿敵、恋人…）', '') ?? ''
      setEdges((eds) => addEdge({ ...c, id: genId(), ...(label ? { label } : {}) }, eds))
    },
    [setEdges],
  )

  const addFreeNode = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: genId(),
        type: 'structure',
        position: { x: 160 + (nds.length % 6) * 36, y: 120 + (nds.length % 6) * 36 },
        data: { label: '新しい人物', kind: 'character' },
      } satisfies Node,
    ])
  }, [setNodes])

  const addGlossaryNode = (entry: GlossaryEntry) => {
    setNodes((nds) => [
      ...nds,
      {
        id: genId(),
        type: 'structure',
        position: { x: 160 + (nds.length % 6) * 36, y: 120 + (nds.length % 6) * 36 },
        data: {
          label: entry.name,
          kind: 'character',
          glossaryRef: entry.id,
          isGlossary: true,
        },
      } satisfies Node,
    ])
    setPickOpen(false)
  }

  return (
    <>
      <StructureCanvas
        nodes={flow.nodes}
        edges={flow.edges}
        onNodesChange={flow.onNodesChange}
        onEdgesChange={flow.onEdgesChange}
        onConnect={onConnect}
        onRenameNode={flow.setNodeLabel}
        onRecolorNode={flow.setNodeColor}
        toolbar={
          <>
            <Button type="button" size="sm" onClick={() => setPickOpen(true)} className="gap-1.5">
              <UserPlus className="size-4" />
              登場人物を追加
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addFreeNode}
              className="gap-1.5 bg-surface-container-lowest/90 text-primary backdrop-blur"
            >
              <Plus className="size-4" />
              自由ノード
            </Button>
          </>
        }
      />

      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-primary text-xl">
              図鑑から登場人物を追加
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {glossary.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                図鑑にまだ登録がありません。図鑑にキャラを登録すると、ここから相関図に追加できます。
              </p>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                図鑑のキャラはすべて相関図に追加済みです。
              </p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto py-1">
                {candidates.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => addGlossaryNode(g)}
                      className="flex w-full items-center gap-2 rounded-md border border-outline-variant/30 bg-surface-container-lowest p-2.5 text-left font-sans text-[13px] text-on-surface transition-colors hover:border-primary/40 hover:bg-surface-container-low"
                    >
                      <span className="font-medium">{g.name}</span>
                      {g.category ? (
                        <span className="text-on-surface-variant text-xs">{g.category}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
