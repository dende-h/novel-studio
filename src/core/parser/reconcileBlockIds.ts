import type { Block } from '../schema'

/**
 * 保存時の再パースで振り直された block id を、直前の blocks から引き継いで安定させる。
 *
 * 背景: 正本の id はパーサが行番号で採番する（`b${i+1}`）ため、素通しだと1行の挿入で
 * 以降の全 id がずれる。id をアンカーに使う機能（ノベルゲームの演出譜 Staging・
 * docs/requirement/07-novel-game.md §2.3）は「編集をまたいで同じ段落が同じ id を保つ」
 * ことを前提にするので、本文を再パースする保存の入口（editorStore の save・MCP の
 * set_episode）で毎回これを通す。
 *
 * 対応の取り方（2パス）:
 * 1. **内容の完全一致**（inlines を比較）を出現順に対応させる — 編集していない行は、
 *    位置が動いても（挿入・削除・並べ替え）必ず旧 id を保つ。
 * 2. **残り＝内容が変わった行**を位置順に対応させる — 1行の推敲で id が変わって
 *    演出が外れるのを防ぐ。複数行を同時に書き換えると対応がずれることはあり得るが、
 *    cue は表示演出で1クリックで直せるため、「編集した行の演出を守る」利得を優先する。
 *
 * どちらでも対応が取れなかった行は、パーサの id をそのまま使う（既存 id と衝突する
 * ときだけ genId で振り直す）＝旧データ・既存テストの `b1` 形式と滑らかに共存する。
 * 出力の id は常に一意。入力は変更しない。
 */
export function reconcileBlockIds(
  prev: Block[],
  next: Block[],
  genId: () => string = defaultGenId,
): Block[] {
  // 内容キー → 旧 id の出現順キュー（旧 id の重複は先勝ちで無視＝出力の一意性を守る）
  const queues = new Map<string, string[]>()
  const prevIds = new Set<string>()
  for (const block of prev) {
    if (prevIds.has(block.id)) continue
    prevIds.add(block.id)
    const key = JSON.stringify(block.inlines)
    const queue = queues.get(key)
    if (queue) queue.push(block.id)
    else queues.set(key, [block.id])
  }

  // パス1: 内容の完全一致
  const assigned: (string | undefined)[] = next.map((block) => {
    return queues.get(JSON.stringify(block.inlines))?.shift()
  })

  // パス2: 未対応の行同士を位置順に対応（=内容が変わった行の引き継ぎ）
  const used = new Set(assigned.filter((id): id is string => id !== undefined))
  const leftoverQueue = [...prevIds].filter((id) => !used.has(id))
  for (let i = 0; i < assigned.length && leftoverQueue.length > 0; i++) {
    if (assigned[i] !== undefined) continue
    const id = leftoverQueue.shift()
    if (id !== undefined) {
      assigned[i] = id
      used.add(id)
    }
  }

  // パス3: 新しい行。パーサの id を優先し、衝突するときだけ振り直す
  const taken = new Set(used)
  return next.map((block, i) => {
    let id = assigned[i]
    if (id === undefined) {
      id = block.id
      let n = 2
      while (taken.has(id)) id = `${genId()}-${n++}`
    }
    taken.add(id)
    return block.id === id ? block : { ...block, id }
  })
}

function defaultGenId(): string {
  return `b_${crypto.randomUUID().slice(0, 8)}`
}
