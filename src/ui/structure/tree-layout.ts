import type { Structure } from '@/core/structure'

/**
 * マインドマップの自動レイアウト（純ロジック）。
 * parentId のツリーを左→右に配置する。ドラッグ不要でノードを増やすほど自動整列する。
 * x = 深さ、y = サブツリーの葉の中央。
 */

export interface Pos {
  x: number
  y: number
}

const X_GAP = 210
const Y_GAP = 68

/** Structure（parentId 木）から各ノードの表示座標を求める。 */
export function layoutTree(s: Structure): Record<string, Pos> {
  const children = new Map<string, string[]>()
  for (const n of s.nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }

  const pos: Record<string, Pos> = {}
  let leaf = 0

  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? []
    let ySlot: number
    if (kids.length === 0) {
      ySlot = leaf
      leaf += 1
    } else {
      const ys = kids.map((k) => place(k, depth + 1))
      ySlot = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2
    }
    pos[id] = { x: depth * X_GAP, y: ySlot * Y_GAP }
    return ySlot
  }

  for (const n of s.nodes) {
    if (!n.parentId) place(n.id, 0)
  }
  return pos
}
