import { type Edge, type Node, useEdgesState, useNodesState } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure, StructureKind } from '@/core/structure'
import { ensurePrimaryStructure } from './ensure-structure'
import { fromFlow, type ResolveGlossary, toFlowEdges, toFlowNodes } from './flow-adapter'

/** 変更を永続化するまでの静止時間(ms)。 */
const SAVE_DELAY_MS = 800

/**
 * 構造ビュー（マインドマップ・相関図）共通のロジック。
 * 指定作品の該当 kind を読み込み（無ければ作成）、変更を静止後に Structure へ書き戻す。
 * resolveGlossary を渡すと図鑑参照ノードの表示ラベルを解決する（相関図用）。
 */
export function useStructureFlow(
  repo: StructureRepository,
  workId: string,
  kind: StructureKind,
  opts?: { title?: string; resolveGlossary?: ResolveGlossary },
) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const baseRef = useRef<Structure | null>(null)
  const [ready, setReady] = useState(false)
  const resolve = opts?.resolveGlossary

  // 初期ロード：この作品の該当 kind を内容優先で 1 つ取得（無ければ決定的 id で作成）。
  useEffect(() => {
    let alive = true
    void (async () => {
      // 内容優先で 1 つに決める（同期レースの空重複は掃除・無ければ決定的 id で生成）。
      const found = await ensurePrimaryStructure(repo, workId, kind, opts?.title)
      if (!alive) return
      baseRef.current = found
      setNodes(toFlowNodes(found, resolve))
      setEdges(toFlowEdges(found))
      setReady(true)
    })()
    return () => {
      alive = false
    }
    // opts はインラインで渡されるため resolve/title を個別依存にする
  }, [repo, workId, kind, opts?.title, resolve, setNodes, setEdges])

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

  /** 選択ノードのラベルをまとめて置換（プレーンな data マージ）。 */
  const setNodeLabel = useCallback(
    (id: string, label: string) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)))
    },
    [setNodes],
  )

  /** 選択ノードの色を変更する。 */
  const setNodeColor = useCallback(
    (id: string, color: string) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, color } } : n)))
    },
    [setNodes],
  )

  return {
    nodes,
    edges,
    ready,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    setNodeLabel,
    setNodeColor,
  }
}
