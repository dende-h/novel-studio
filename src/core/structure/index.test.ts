import { describe, expect, it } from 'vitest'
import {
  addEdge,
  addNode,
  emptyStructure,
  removeEdge,
  removeNode,
  type StructureNode,
  updateNode,
} from './index'

const node = (id: string, kind: StructureNode['kind'] = 'idea'): StructureNode => ({
  id,
  kind,
  label: id,
})

describe('structure（共通操作の純関数）', () => {
  it('emptyStructure は空の器を作る（title は任意）', () => {
    const s = emptyStructure('s1', 'w1', 'chart', 100)
    expect(s).toEqual({
      id: 's1',
      workId: 'w1',
      kind: 'chart',
      nodes: [],
      edges: [],
      updatedAt: 100,
    })
    expect(emptyStructure('s2', 'w1', 'mindmap', 1, '発想メモ').title).toBe('発想メモ')
  })

  it('addNode / updateNode', () => {
    let s = emptyStructure('s1', 'w1', 'chart', 0)
    s = addNode(s, node('a'))
    s = updateNode(s, 'a', { label: '主人公', glossaryRef: 'g1' })
    expect(s.nodes[0]).toMatchObject({ id: 'a', label: '主人公', glossaryRef: 'g1' })
  })

  it('removeNode は関連エッジも消す', () => {
    let s = emptyStructure('s1', 'w1', 'chart', 0)
    s = addNode(addNode(s, node('a')), node('b'))
    s = addEdge(s, { id: 'e1', from: 'a', to: 'b', kind: 'relation' })
    s = removeNode(s, 'a')
    expect(s.nodes.map((n) => n.id)).toEqual(['b'])
    expect(s.edges).toHaveLength(0) // a に繋がる e1 も消える
  })

  it('addEdge / removeEdge', () => {
    let s = emptyStructure('s1', 'w1', 'chart', 0)
    s = addNode(addNode(s, node('a')), node('b'))
    s = addEdge(s, { id: 'e1', from: 'a', to: 'b', label: '師弟', kind: 'relation' })
    expect(s.edges[0]).toMatchObject({ label: '師弟' })
    s = removeEdge(s, 'e1')
    expect(s.edges).toHaveLength(0)
  })
})
