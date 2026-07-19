import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { addEdge, addNode, emptyStructure } from '@/core/structure'
import { fromFlow, toFlowEdges, toFlowNodes } from './flow-adapter'

const base = (() => {
  let s = emptyStructure('s1', 'w1', 'mindmap', 0)
  s = addNode(s, { id: 'a', kind: 'idea', label: 'A', x: 10, y: 20, color: 'forest' })
  s = addNode(s, { id: 'b', kind: 'character', label: 'B', glossaryRef: 'g1' })
  s = addEdge(s, { id: 'e1', from: 'a', to: 'b', label: '連想', kind: 'association' })
  return s
})()

describe('flow-adapter（Structure ⇄ React Flow）', () => {
  it('toFlowNodes は position/label/kind/color を data に載せる（未設定は原点）', () => {
    const ns = toFlowNodes(base)
    expect(ns.find((n) => n.id === 'a')).toMatchObject({
      type: 'structure',
      position: { x: 10, y: 20 },
      data: { label: 'A', kind: 'idea', color: 'forest' },
    })
    expect(ns.find((n) => n.id === 'b')?.position).toEqual({ x: 0, y: 0 })
  })

  it('toFlowNodes は resolveGlossary で参照ノードの表示ラベルを解決し、印を付ける', () => {
    const ns = toFlowNodes(base, (id) => (id === 'g1' ? '主人公' : null))
    expect(ns.find((n) => n.id === 'b')?.data).toMatchObject({
      label: '主人公',
      isGlossary: true,
      refMissing: false,
      glossaryRef: 'g1',
    })
  })

  it('解決できない参照は refMissing=true・元ラベルにフォールバック', () => {
    const ns = toFlowNodes(base, () => null)
    expect(ns.find((n) => n.id === 'b')?.data).toMatchObject({ label: 'B', refMissing: true })
  })

  it('toFlowEdges は source/target/label を移す', () => {
    expect(toFlowEdges(base)[0]).toMatchObject({ source: 'a', target: 'b', label: '連想' })
  })

  it('fromFlow は位置・ラベル・色を書き戻し、note 等は base から保つ', () => {
    const flowNodes: Node[] = toFlowNodes(base).map((n) =>
      n.id === 'a' ? { ...n, position: { x: 99, y: 5 }, data: { ...n.data, label: '主人公' } } : n,
    )
    const next = fromFlow(base, flowNodes, toFlowEdges(base), 100)
    expect(next.nodes.find((n) => n.id === 'a')).toMatchObject({
      x: 99,
      y: 5,
      label: '主人公',
      kind: 'idea',
      color: 'forest',
    })
    expect(next.nodes.find((n) => n.id === 'b')).toMatchObject({
      glossaryRef: 'g1',
      kind: 'character',
    })
    expect(next.edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'association', label: '連想' })
    expect(next.updatedAt).toBe(100)
  })

  it('fromFlow は base に無い新規ノードの kind/glossaryRef を data から拾う（参照が失われない）', () => {
    const flowNodes = [
      ...toFlowNodes(base),
      {
        id: 'new',
        type: 'structure',
        position: { x: 5, y: 6 },
        data: { label: '新キャラ', kind: 'character', glossaryRef: 'g9', isGlossary: true },
      } as Node,
    ]
    const next = fromFlow(base, flowNodes, toFlowEdges(base), 1)
    expect(next.nodes.find((n) => n.id === 'new')).toMatchObject({
      kind: 'character',
      glossaryRef: 'g9',
      label: '新キャラ',
      x: 5,
      y: 6,
    })
  })
})
