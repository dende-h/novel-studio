import { addEdge, type Connection, type Node } from '@xyflow/react'
import { Plus, UserPlus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { GlossaryEntry } from '@/core/schema'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { StructureCanvas } from '@/ui/components/StructureCanvas/structure-canvas'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
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
  /** 用語集エントリ一覧（参照ノードの解決・追加候補に使う）。 */
  glossary: GlossaryEntry[]
}

const genId = () => crypto.randomUUID()

/**
 * 相関図（構造レイヤー kind:chart）。用語集のキャラを参照ノードにし、関係ラベル付きの辺で結ぶ。
 * 用語集に無い端役は自由ノードで置ける。バンドルが重いので default export（遅延ロード）。
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
  // 関係ラベル入力モーダル（window.prompt の置き換え）。繋ぎかけの接続を保持して待つ。
  const [relOpen, setRelOpen] = useState(false)
  const pendingConnection = useRef<Connection | null>(null)

  // まだ相関図に載っていない用語集キャラ。
  const usedRefs = useMemo(
    () =>
      new Set(nodes.map((n) => (n.data as { glossaryRef?: string }).glossaryRef).filter(Boolean)),
    [nodes],
  )
  const candidates = glossary.filter((g) => !usedRefs.has(g.id))

  // 接続時は関係ラベルのモーダルを開き、繋ぎかけの接続を保持する。
  const onConnect = useCallback((c: Connection) => {
    pendingConnection.current = c
    setRelOpen(true)
  }, [])

  // モーダル送信：保持していた接続にラベルを付けて辺を追加（空ならラベル無し）。
  const submitRelation = useCallback(
    (label: string) => {
      const c = pendingConnection.current
      pendingConnection.current = null
      if (!c) return
      const trimmed = label.trim()
      setEdges((eds) => addEdge({ ...c, id: genId(), ...(trimmed ? { label: trimmed } : {}) }, eds))
    },
    [setEdges],
  )

  // ノード削除（関連する辺も除去）。変更は自動保存される。
  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    },
    [setNodes, setEdges],
  )
  const deleteEdge = useCallback(
    (id: string) => setEdges((eds) => eds.filter((e) => e.id !== id)),
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
        onDeleteNode={deleteNode}
        onDeleteEdge={deleteEdge}
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
              用語集から登場人物を追加
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {glossary.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                用語集にまだ登録がありません。用語集にキャラを登録すると、ここから相関図に追加できます。
              </p>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-on-surface-variant text-sm">
                用語集のキャラはすべて相関図に追加済みです。
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

      <TitlePromptDialog
        open={relOpen}
        onOpenChange={(o) => {
          setRelOpen(o)
          if (!o) pendingConnection.current = null // キャンセル時は接続を破棄
        }}
        title="関係を追加"
        description="2人のつながりを表すラベル（空欄可）"
        label="関係"
        placeholder="例：師弟、宿敵、恋人…"
        submitLabel="つなぐ"
        onSubmit={submitRelation}
      />
    </>
  )
}
