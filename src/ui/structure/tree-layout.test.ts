import { describe, expect, it } from 'vitest'
import { addEdge, addNode, emptyStructure } from '@/core/structure'
import { layoutTree, type Pos } from './tree-layout'

/** 座標を取り出す（無ければ失敗）。noUncheckedIndexedAccess 対策。 */
const at = (p: Record<string, Pos>, k: string): Pos => {
  const v = p[k]
  if (!v) throw new Error(`位置なし: ${k}`)
  return v
}

describe('tree-layout（マインドマップの自動配置）', () => {
  it('単一の根は原点', () => {
    const s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '' })
    expect(layoutTree(s).r).toEqual({ x: 0, y: 0 })
  })

  it('子は右(深さ)へ、根の y は子の中央', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '根' })
    s = addNode(s, { id: 'a', kind: 'idea', label: 'a', parentId: 'r' })
    s = addNode(s, { id: 'b', kind: 'idea', label: 'b', parentId: 'r' })
    s = addEdge(addEdge(s, { id: 'e1', from: 'r', to: 'a', kind: 'association' }), {
      id: 'e2',
      from: 'r',
      to: 'b',
      kind: 'association',
    })
    const p = layoutTree(s)
    expect(at(p, 'a').x).toBeGreaterThan(at(p, 'r').x) // 子は右
    expect(at(p, 'b').x).toBe(at(p, 'a').x) // 同じ深さ
    expect(at(p, 'a').y).not.toBe(at(p, 'b').y) // 縦に分かれる
    expect(at(p, 'r').y).toBeCloseTo((at(p, 'a').y + at(p, 'b').y) / 2) // 根は子の中央
  })

  it('孫はさらに右へ', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '' })
    s = addNode(s, { id: 'a', kind: 'idea', label: '', parentId: 'r' })
    s = addNode(s, { id: 'a1', kind: 'idea', label: '', parentId: 'a' })
    const p = layoutTree(s)
    expect(at(p, 'a1').x).toBeGreaterThan(at(p, 'a').x)
    expect(at(p, 'a').x).toBeGreaterThan(at(p, 'r').x)
  })
})
