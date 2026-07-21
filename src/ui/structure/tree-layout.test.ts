import { describe, expect, it } from 'vitest'
import { addEdge, addNode, emptyStructure } from '@/core/structure'
import { layoutTree, type NodeLayout } from './tree-layout'

/** 座標を取り出す（無ければ失敗）。noUncheckedIndexedAccess 対策。 */
const at = (p: Record<string, NodeLayout>, k: string): NodeLayout => {
  const v = p[k]
  if (!v) throw new Error(`位置なし: ${k}`)
  return v
}

describe('tree-layout（マインドマップの自動配置）', () => {
  it('単一の根は原点・depth 0・dir 0', () => {
    const s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '' })
    expect(layoutTree(s).r).toEqual({ x: 0, y: 0, depth: 0, dir: 0 })
  })

  it('中心の子は交互に右・左へ振り分けられる', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '根' })
    s = addNode(s, { id: 'a', kind: 'idea', label: 'a', parentId: 'r' }) // index0 → 右
    s = addNode(s, { id: 'b', kind: 'idea', label: 'b', parentId: 'r' }) // index1 → 左
    s = addEdge(addEdge(s, { id: 'e1', from: 'r', to: 'a', kind: 'association' }), {
      id: 'e2',
      from: 'r',
      to: 'b',
      kind: 'association',
    })
    const p = layoutTree(s)
    expect(at(p, 'a').x).toBeGreaterThan(0) // 右
    expect(at(p, 'a').dir).toBe(1)
    expect(at(p, 'b').x).toBeLessThan(0) // 左
    expect(at(p, 'b').dir).toBe(-1)
    expect(Math.abs(at(p, 'a').x)).toBe(Math.abs(at(p, 'b').x)) // 対称
  })

  it('孫は親と同じ向きへさらに伸び、depth が増える', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '' })
    s = addNode(s, { id: 'a', kind: 'idea', label: '', parentId: 'r' }) // 右
    s = addNode(s, { id: 'a1', kind: 'idea', label: '', parentId: 'a' })
    const p = layoutTree(s)
    expect(at(p, 'a1').x).toBeGreaterThan(at(p, 'a').x) // さらに右
    expect(at(p, 'a1').dir).toBe(1)
    expect(at(p, 'r').depth).toBe(0)
    expect(at(p, 'a').depth).toBe(1)
    expect(at(p, 'a1').depth).toBe(2)
  })
})
