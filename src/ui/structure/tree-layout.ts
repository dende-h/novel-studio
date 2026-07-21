import type { Structure } from '@/core/structure'

/**
 * マインドマップの自動レイアウト（純ロジック）。
 * parentId のツリーを左→右に配置する。ドラッグ不要でノードを増やすほど自動整列する。
 * x = 深さ、y = サブツリーの葉の中央。depth はフォント段階（中心/第2/第3以降）にも使う。
 * 間隔はノードが重ならないよう広めに取る。
 */

export interface NodeLayout {
  x: number
  y: number
  /** 階層（0=中心）。 */
  depth: number
}

/** 列間（ノード幅より広く取り、横の重なりを防ぐ）。 */
const X_GAP = 280
/** 葉1つ分の縦間隔（ノード高より広く取り、縦の重なりを防ぐ）。 */
const Y_GAP = 92

/** Structure（parentId 木）から各ノードの表示座標と深さを求める。 */
export function layoutTree(s: Structure): Record<string, NodeLayout> {
  const children = new Map<string, string[]>()
  for (const n of s.nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }

  const out: Record<string, NodeLayout> = {}
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
    out[id] = { x: depth * X_GAP, y: ySlot * Y_GAP, depth }
    return ySlot
  }

  for (const n of s.nodes) {
    if (!n.parentId) place(n.id, 0)
  }
  return out
}
