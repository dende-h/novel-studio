import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { StickyNote } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IdeaNote } from '@/core/idea'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { StructureRepository } from '@/core/storage/structureRepository'
import {
  addNode,
  addEdge as addStructEdge,
  removeNode,
  type Structure,
  updateNode,
} from '@/core/structure'
import { MINDMAP_NODE_TYPES, MindmapContext } from '@/ui/components/MindmapView/mindmap-node'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { layoutTree } from '@/ui/structure/tree-layout'

interface MindmapViewProps {
  repo: StructureRepository
  workId: string
  /** ネタ帳（アイデアの受け皿）。取り込みボタンで使う。省略時は取り込み非表示。 */
  ideaRepo?: IdeaRepository
}

const genId = () => crypto.randomUUID()
const SAVE_DELAY_MS = 600

/** ノードとその子孫をまとめて削除する（関連エッジも除去）。 */
function removeSubtree(s: Structure, rootId: string): Structure {
  const ids: string[] = []
  const walk = (id: string) => {
    ids.push(id)
    for (const n of s.nodes) if (n.parentId === id) walk(n.id)
  }
  walk(rootId)
  return ids.reduce((acc, id) => removeNode(acc, id), s)
}

/**
 * マインドマップ（構造レイヤー kind:mindmap）。中心ノードから＋で枝を生やす自動レイアウトのツリー。
 * ドラッグはせず、操作は「ノードへの入力」と「＋で子を生やす」の2つだけ。default export（遅延ロード）。
 */
export default function MindmapView({ repo, workId, ideaRepo }: MindmapViewProps) {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [ideas, setIdeas] = useState<IdeaNote[]>([])
  const dirty = useRef(false)

  // 初期ロード：mindmap を取得（無ければ作成）。空なら中心ノードを1つ用意する。
  useEffect(() => {
    let alive = true
    void (async () => {
      const list = await repo.listByWork(workId)
      let mm =
        list.find((s) => s.kind === 'mindmap') ??
        (await repo.create(workId, 'mindmap', 'マインドマップ'))
      if (mm.nodes.length === 0) {
        mm = await repo.save(addNode(mm, { id: genId(), kind: 'idea', label: '' }))
      }
      if (alive) {
        dirty.current = false
        setStructure(mm)
      }
    })()
    return () => {
      alive = false
    }
  }, [repo, workId])

  // structure → React Flow（自動レイアウトで座標を毎回算出・ドラッグ不可）。
  useEffect(() => {
    if (!structure) return
    const pos = layoutTree(structure)
    setRfNodes(
      structure.nodes.map((n) => ({
        id: n.id,
        type: 'mindmap',
        draggable: false,
        position: { x: pos[n.id]?.x ?? 0, y: pos[n.id]?.y ?? 0 },
        data: {
          label: n.label,
          isRoot: !n.parentId,
          depth: pos[n.id]?.depth ?? 0,
          dir: pos[n.id]?.dir ?? 0,
        },
      })),
    )
    setRfEdges(
      structure.edges.map((e) => {
        // 子が左枝なら親の左→子の右、右枝なら親の右→子の左へ繋ぐ。
        const left = (pos[e.to]?.dir ?? 1) < 0
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'smoothstep',
          sourceHandle: left ? 'src-l' : 'src-r',
          targetHandle: left ? 'tgt-r' : 'tgt-l',
        }
      }),
    )
  }, [structure, setRfNodes, setRfEdges])

  // 変更を静止後に永続化。
  useEffect(() => {
    if (!structure || !dirty.current) return
    const t = setTimeout(() => {
      void repo.save(structure)
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [structure, repo])

  const mutate = useCallback((fn: (s: Structure) => Structure) => {
    dirty.current = true
    setStructure((s) => (s ? fn(s) : s))
  }, [])

  const onLabelChange = useCallback(
    (id: string, label: string) => mutate((s) => updateNode(s, id, { label })),
    [mutate],
  )

  const addChild = useCallback(
    (parentId: string, label = '') => {
      const childId = genId()
      mutate((s) => {
        const withNode = addNode(s, { id: childId, kind: 'idea', label, parentId })
        return addStructEdge(withNode, {
          id: genId(),
          from: parentId,
          to: childId,
          kind: 'association',
        })
      })
      setSelectedId(childId)
      setFocusId(childId)
      return childId
    },
    [mutate],
  )

  const onAddChild = useCallback((id: string) => addChild(id), [addChild])
  const onDelete = useCallback(
    (id: string) =>
      mutate((s) => {
        const next = removeSubtree(s, id)
        // 空になったら中心ノードを1つ再生成（常に最低1ノード）。
        return next.nodes.length === 0
          ? addNode(next, { id: genId(), kind: 'idea', label: '' })
          : next
      }),
    [mutate],
  )

  const ctx = useMemo(
    () => ({ onLabelChange, onAddChild, onDelete, focusId }),
    [onLabelChange, onAddChild, onDelete, focusId],
  )

  const openIdeaPicker = useCallback(async () => {
    if (!ideaRepo) return
    setIdeas(await ideaRepo.list())
    setIdeaOpen(true)
  }, [ideaRepo])

  useEffect(() => {
    if (!ideaOpen) setIdeas([])
  }, [ideaOpen])

  const importIdea = (idea: IdeaNote) => {
    // 選択中ノード（無ければ最初の根）の子として取り込む。
    const parent = selectedId ?? structure?.nodes.find((n) => !n.parentId)?.id
    if (parent) addChild(parent, idea.text)
    setIdeaOpen(false)
  }

  return (
    <MindmapContext.Provider value={ctx}>
      <div className="relative h-full w-full">
        {ideaRepo ? (
          <div className="absolute top-3 left-3 z-10">
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
          </div>
        ) : null}

        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={MINDMAP_NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

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
    </MindmapContext.Provider>
  )
}
