import type { Structure } from '@/core/structure'

/**
 * マインドマップの自動レイアウト（純ロジック）。
 * 中心（根）から左右両方向へ枝を伸ばす。各ノードの向きは node.side（'l'|'r'）で決まり、
 * 未指定の根直下は右、深い階層は親の向きを継ぐ。左右それぞれを縦に詰めて中心に揃える。
 * x = 向き×深さ、y = サブツリーの葉。depth はフォント段階、dir はハンドル/＋ボタンに使う。
 */

export interface NodeLayout {
  x: number
  y: number
  /** 階層（0=中心）。 */
  depth: number
  /** 伸びる向き（-1=左, 0=中心, 1=右）。 */
  dir: number
}

/** 列間（左右方向・ノード幅より広く）。 */
const X_GAP = 280
/** 葉1つ分の縦間隔（詰めて視認性を上げる）。 */
const Y_GAP = 50

/** Structure（parentId 木）から各ノードの座標・深さ・向きを求める。 */
export function layoutTree(s: Structure): Record<string, NodeLayout> {
  const nodeById = new Map(s.nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  for (const n of s.nodes) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }

  /** node.side を向き(-1/1)へ。未指定は null。 */
  const sideDir = (id: string): number | null => {
    const sd = nodeById.get(id)?.side
    return sd === 'l' ? -1 : sd === 'r' ? 1 : null
  }

  const out: Record<string, NodeLayout> = {}
  let base = 0 // 複数の根を縦に積むためのオフセット（葉スロット単位）

  // 1 つの枝（根直下ノード＝depth1 以降）を配置。y は counter のスロット、dir は解決済みの向き。
  const place = (
    id: string,
    depth: number,
    dir: number,
    counter: { v: number },
    placed: string[],
  ): number => {
    placed.push(id)
    const kids = children.get(id) ?? []
    let ySlot: number
    if (kids.length === 0) {
      ySlot = counter.v
      counter.v += 1
    } else {
      const ys = kids.map((k) => place(k, depth + 1, sideDir(k) ?? dir, counter, placed))
      ySlot = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2
    }
    out[id] = { x: dir * depth * X_GAP, y: ySlot, depth, dir }
    return ySlot
  }

  for (const root of s.nodes.filter((n) => !n.parentId)) {
    const placed: string[] = []
    const kids = (children.get(root.id) ?? []).map((k) => ({ id: k, dir: sideDir(k) ?? 1 }))
    const rightCtr = { v: 0 }
    const leftCtr = { v: 0 }
    const rightYs = kids.filter((k) => k.dir >= 0).map((k) => place(k.id, 1, 1, rightCtr, placed))
    const leftYs = kids.filter((k) => k.dir < 0).map((k) => place(k.id, 1, -1, leftCtr, placed))
    placed.push(root.id)
    const childYs = [...rightYs, ...leftYs]
    const rootSlot = childYs.length ? (Math.min(...childYs) + Math.max(...childYs)) / 2 : 0
    out[root.id] = { x: 0, y: rootSlot, depth: 0, dir: 0 }

    // この根ブロックを base ぶん下げ、スロット→ピクセルへ変換。
    for (const id of placed) {
      const layout = out[id]
      if (layout) layout.y = (layout.y + base) * Y_GAP
    }
    base += Math.max(rightCtr.v, leftCtr.v, 1) + 1
  }
  return out
}
