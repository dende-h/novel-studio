import { addEdge, type Connection, type Node } from '@xyflow/react'
import { Plus, StickyNote } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { IdeaNote } from '@/core/idea'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
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

interface MindmapViewProps {
  repo: StructureRepository
  workId: string
  /** ネタ帳（アイデアの受け皿）。取り込みボタンで使う。省略時は取り込み非表示。 */
  ideaRepo?: IdeaRepository
}

const genId = () => crypto.randomUUID()

/**
 * マインドマップ（構造レイヤー kind:mindmap）。共通キャンバスの上に、
 * ノード追加・ネタ帳取り込みのツールバーを載せる。バンドルが重いので default export（遅延ロード）。
 */
export default function MindmapView({ repo, workId, ideaRepo }: MindmapViewProps) {
  const flow = useStructureFlow(repo, workId, 'mindmap', { title: '発想メモ' })
  const { setNodes, setEdges } = flow
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [ideas, setIdeas] = useState<IdeaNote[]>([])

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: genId() }, eds)),
    [setEdges],
  )

  const addNodeAt = useCallback(
    (label: string) => {
      setNodes((nds) => [
        ...nds,
        {
          id: genId(),
          type: 'structure',
          position: { x: 140 + (nds.length % 6) * 36, y: 100 + (nds.length % 6) * 36 },
          data: { label },
        } satisfies Node,
      ])
    },
    [setNodes],
  )

  const openIdeaPicker = useCallback(async () => {
    if (!ideaRepo) return
    setIdeas(await ideaRepo.list())
    setIdeaOpen(true)
  }, [ideaRepo])

  // ダイアログを閉じたら一覧をクリア（次回開くとき最新を読み直す）。
  useEffect(() => {
    if (!ideaOpen) setIdeas([])
  }, [ideaOpen])

  const importIdea = (idea: IdeaNote) => {
    addNodeAt(idea.text)
    setIdeaOpen(false)
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
            <Button
              type="button"
              size="sm"
              onClick={() => addNodeAt('新しいノード')}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              ノードを追加
            </Button>
            {ideaRepo ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void openIdeaPicker()}
                className="gap-1.5 bg-surface-container-lowest/90 text-primary backdrop-blur"
              >
                <StickyNote className="size-4" />
                ネタ帳から
              </Button>
            ) : null}
          </>
        }
      />

      <Dialog open={ideaOpen} onOpenChange={setIdeaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-primary text-xl">
              ネタ帳から取り込む
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {ideas.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                ネタ帳が空です。先にネタ帳へ書き留めておくと、ここから取り込めます。
              </p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto py-1">
                {ideas.map((idea) => (
                  <li key={idea.id}>
                    <button
                      type="button"
                      onClick={() => importIdea(idea)}
                      className="w-full rounded-md border border-outline-variant/30 bg-surface-container-lowest p-2.5 text-left font-sans text-[13px] text-on-surface transition-colors hover:border-primary/40 hover:bg-surface-container-low"
                    >
                      {idea.text}
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
