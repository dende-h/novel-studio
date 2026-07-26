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

/**
 * レイアウトに効くトポロジ（ノードの id/親/向き・エッジ）の署名。ラベルは含めない。
 * layoutTree は座標をトポロジのみから決めるため、ラベル編集のたびに React Flow のノードを
 * 作り直す必要はない。作り直すと未計測ノードが一瞬 visibility:hidden になり、入力中の
 * フォーカスが飛ぶ（1〜2文字で入力が外れる不具合）。この署名が変わったときだけ再構築する。
 */
function topoSignature(s: Structure): string {
  const nodes = s.nodes.map((n) => `${n.id}/${n.parentId ?? ''}/${n.side ?? ''}`).join('|')
  const edges = s.edges.map((e) => `${e.id}/${e.from}/${e.to}`).join('|')
  return `${nodes}#${edges}`
}

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
  // 直近に React Flow へ反映したトポロジ署名。ラベルだけの変更で作り直さないための番人。
  const lastTopoSig = useRef('')

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

  // structure → React Flow（トポロジ変化時だけ座標を再算出・ドラッグ不可）。
  // ラベル編集ではノードを作り直さない：作り直すと未計測ノードが一瞬隠れ、入力中の
  // フォーカスが飛ぶ。ラベルはノード側のローカル state が正本なので反映は不要。
  useEffect(() => {
    if (!structure) return
    const sig = topoSignature(structure)
    if (sig === lastTopoSig.current) return
    lastTopoSig.current = sig
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
    (parentId: string, side: 'l' | 'r', label = '') => {
      const childId = genId()
      mutate((s) => {
        const withNode = addNode(s, { id: childId, kind: 'idea', label, parentId, side })
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

  const onAddChild = useCallback((id: string, side: 'l' | 'r') => addChild(id, side), [addChild])
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
    // 選択中ノード（無ければ最初の根）の子として、そのノードの向きへ取り込む。
    const parent = selectedId
      ? structure?.nodes.find((n) => n.id === selectedId)
      : structure?.nodes.find((n) => !n.parentId)
    if (parent) addChild(parent.id, parent.side ?? 'r', idea.text)
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
