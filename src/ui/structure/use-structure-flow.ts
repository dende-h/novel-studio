import { type Edge, type Node, useEdgesState, useNodesState } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure, StructureKind } from '@/core/structure'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'
import { ensurePrimaryStructure } from './ensure-structure'
import { fromFlow, type ResolveGlossary, toFlowEdges, toFlowNodes } from './flow-adapter'

/** 変更を永続化するまでの静止時間(ms)。 */
const SAVE_DELAY_MS = 800

/**
 * flow 状態の内容署名。**必ず fromFlow を通した後の形**で取る：flow との往復で座標などが
 * 正規化されるため、保存済み Structure と直接比較すると常に差分が出てしまう。
 * updatedAt は固定値で潰し、内容（ノード・エッジ）だけを比較する。
 */
function contentSig(base: Structure, nodes: Node[], edges: Edge[]): string {
  const s = fromFlow(base, nodes, edges, 0)
  return JSON.stringify({ n: s.nodes, e: s.edges })
}

/**
 * 構造ビュー（マインドマップ・相関図）共通のロジック。
 * 指定作品の該当 kind を読み込み（無ければ作成）、変更を静止後に Structure へ書き戻す。
 * resolveGlossary を渡すと用語集参照ノードの表示ラベルを解決する（相関図用）。
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
  // 最後に「保存済み」とみなした内容署名。これと一致する間は保存しない＝
  // 開いただけで updatedAt を刻印しない（LWW で他端末の実編集に勝つ事故の防止）。
  const savedSigRef = useRef('')
  const [ready, setReady] = useState(false)
  const resolve = opts?.resolveGlossary

  // 初期ロード：この作品の該当 kind を内容優先で 1 つ取得（無ければ決定的 id で作成）。
  useEffect(() => {
    let alive = true
    void (async () => {
      const found = await ensurePrimaryStructure(repo, workId, kind, opts?.title)
      if (!alive) return
      baseRef.current = found
      const fn = toFlowNodes(found, resolve)
      const fe = toFlowEdges(found)
      savedSigRef.current = contentSig(found, fn, fe)
      setNodes(fn)
      setEdges(fe)
      setReady(true)
    })()
    return () => {
      alive = false
    }
    // opts はインラインで渡されるため resolve/title を個別依存にする
  }, [repo, workId, kind, opts?.title, resolve, setNodes, setEdges])

  // 変更を静止後にまとめて永続化する。内容署名が保存済みと同一なら保存しない：
  // 初期ロードの setNodes/setEdges でもこの effect は発火するため、無条件に保存すると
  // **開いただけで updatedAt が進み**、LWW 同期下では「開いただけの端末が他端末の実編集に
  // 勝つ」事故になる（stg で実発生）。
  useEffect(() => {
    if (!ready || !baseRef.current) return
    const t = setTimeout(() => {
      const base = baseRef.current
      if (!base) return
      const sig = contentSig(base, nodes, edges)
      if (sig === savedSigRef.current) return
      void repo.save(fromFlow(base, nodes, edges, Date.now())).then((saved) => {
        baseRef.current = saved
        savedSigRef.current = sig
      })
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [nodes, edges, ready, repo])

  // 同期の pull がローカルを書き換えたら、未保存の編集が無いときだけ画面へ反映する
  // （マウント時読み切りのままだと「ページ遷移しないと同期されない」ように見えるため）。
  useEffect(() => {
    if (!ready) return
    return subscribeSyncApplied(() => {
      void (async () => {
        const base = baseRef.current
        if (!base) return
        // ローカルに未保存の編集がある間は上書きしない（保存されれば通常の push/LWW に乗る）。
        if (contentSig(base, nodes, edges) !== savedSigRef.current) return
        const found = await ensurePrimaryStructure(repo, workId, kind, opts?.title)
        if (found.id === base.id && found.updatedAt === base.updatedAt) return // 変化なし
        baseRef.current = found
        const fn = toFlowNodes(found, resolve)
        const fe = toFlowEdges(found)
        savedSigRef.current = contentSig(found, fn, fe)
        setNodes(fn)
        setEdges(fe)
      })()
    })
  }, [ready, nodes, edges, repo, workId, kind, opts?.title, resolve, setNodes, setEdges])

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
