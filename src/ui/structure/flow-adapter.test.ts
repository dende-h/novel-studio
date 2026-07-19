import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { addEdge, addNode, emptyStructure } from '@/core/structure'
import { fromFlow, toFlowEdges, toFlowNodes } from './flow-adapter'

const base = (() => {
  let s = emptyStructure('s1', 'w1', 'mindmap', 0)
  s = addNode(s, { id: 'a', kind: 'idea', label: 'A', x: 10, y: 20 })
  s = addNode(s, { id: 'b', kind: 'character', label: 'B', glossaryRef: 'g1' })
  s = addEdge(s, { id: 'e1', from: 'a', to: 'b', label: '連想', kind: 'association' })
  return s
})()

describe('flow-adapter（Structure ⇄ React Flow）', () => {
  it('toFlowNodes は position/label を移す（未設定は原点）', () => {
    const ns = toFlowNodes(base)
    expect(ns.find((n) => n.id === 'a')).toMatchObject({
      position: { x: 10, y: 20 },
      data: { label: 'A' },
    })
    expect(ns.find((n) => n.id === 'b')?.position).toEqual({ x: 0, y: 0 })
  })

  it('toFlowEdges は source/target/label を移す', () => {
    expect(toFlowEdges(base)[0]).toMatchObject({ source: 'a', target: 'b', label: '連想' })
  })

  it('fromFlow は位置とラベルを書き戻し、kind・参照は base から保つ', () => {
    const flowNodes: Node[] = toFlowNodes(base).map((n) =>
      n.id === 'a' ? { ...n, position: { x: 99, y: 5 }, data: { label: '主人公' } } : n,
    )
    const next = fromFlow(base, flowNodes, toFlowEdges(base), 100)
    expect(next.nodes.find((n) => n.id === 'a')).toMatchObject({
      x: 99,
      y: 5,
      label: '主人公',
      kind: 'idea',
    })
    // 図鑑参照は React Flow に載らないが base から保持される
    expect(next.nodes.find((n) => n.id === 'b')).toMatchObject({
      glossaryRef: 'g1',
      kind: 'character',
    })
    expect(next.edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'association', label: '連想' })
    expect(next.updatedAt).toBe(100)
  })
})
