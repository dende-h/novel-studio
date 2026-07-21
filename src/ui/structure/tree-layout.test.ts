import { describe, expect, it } from 'vitest'
import { addNode, emptyStructure } from '@/core/structure'
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

  it('中心の子は保存された side で右・左へ分かれる（未指定は右）', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '根' })
    s = addNode(s, { id: 'a', kind: 'idea', label: 'a', parentId: 'r', side: 'r' }) // 右
    s = addNode(s, { id: 'b', kind: 'idea', label: 'b', parentId: 'r', side: 'l' }) // 左
    s = addNode(s, { id: 'c', kind: 'idea', label: 'c', parentId: 'r' }) // 未指定 → 右
    const p = layoutTree(s)
    expect(at(p, 'a').x).toBeGreaterThan(0)
    expect(at(p, 'a').dir).toBe(1)
    expect(at(p, 'b').x).toBeLessThan(0)
    expect(at(p, 'b').dir).toBe(-1)
    expect(at(p, 'c').dir).toBe(1) // 未指定は右
    expect(Math.abs(at(p, 'a').x)).toBe(Math.abs(at(p, 'b').x)) // 左右対称
  })

  it('孫は親の向きを継いでさらに伸びる（左枝はさらに左）', () => {
    let s = addNode(emptyStructure('s', 'w', 'mindmap', 0), { id: 'r', kind: 'idea', label: '' })
    s = addNode(s, { id: 'a', kind: 'idea', label: '', parentId: 'r', side: 'l' }) // 左
    s = addNode(s, { id: 'a1', kind: 'idea', label: '', parentId: 'a' }) // 親を継ぐ→左
    const p = layoutTree(s)
    expect(at(p, 'a1').x).toBeLessThan(at(p, 'a').x) // さらに左
    expect(at(p, 'a1').dir).toBe(-1)
    expect(at(p, 'r').depth).toBe(0)
    expect(at(p, 'a').depth).toBe(1)
    expect(at(p, 'a1').depth).toBe(2)
  })
})
