import type { Structure } from '@/core/structure'

/**
 * マインドマップの自動レイアウト（純ロジック）。
 * 中心（根）から左右両方向へ枝を伸ばす。中心の直接の子を交互に右・左へ振り分け、
 * それ以降の子孫は親と同じ向きへ伸びる。x = 向き×深さ、y = サブツリーの葉の中央。
 * depth はフォント段階（中心/第2/第3以降）、dir はハンドル/＋ボタンの左右に使う。
 */

export interface NodeLayout {
  x: number
  y: number
  /** 階層（0=中心）。 */
  depth: number
  /** 伸びる向き（-1=左, 0=中心, 1=右）。 */
  dir: number
}

/** 列間（ノード幅より広く取り、横の重なりを防ぐ）。 */
const X_GAP = 280
/** 葉1つ分の縦間隔（ノード高より広く取り、縦の重なりを防ぐ）。 */
const Y_GAP = 92

/** Structure（parentId 木）から各ノードの座標・深さ・向きを求める。 */
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

  const place = (id: string, depth: number, dir: number): number => {
    const kids = children.get(id) ?? []
    let ySlot: number
    if (kids.length === 0) {
      ySlot = leaf
      leaf += 1
    } else {
      const ys = kids.map((k, i) => {
        // 中心の子は交互に右(偶数)・左(奇数)へ。以降は親の向きを継ぐ。
        const childDir = depth === 0 ? (i % 2 === 0 ? 1 : -1) : dir
        return place(k, depth + 1, childDir)
      })
      ySlot = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2
    }
    out[id] = { x: dir * depth * X_GAP, y: ySlot * Y_GAP, depth, dir }
    return ySlot
  }

  for (const n of s.nodes) {
    if (!n.parentId) place(n.id, 0, 0)
  }
  return out
}
