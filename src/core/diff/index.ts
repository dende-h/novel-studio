/**
 * 行単位の最小差分（純ロジック）。履歴の版を復元する前の
 * 「現在の版 vs 復元する版」の目視確認に使う。
 * 共通の先頭・末尾を除いた中間部だけを LCS で対応付け、
 * 中間部が大きすぎる場合は全削除＋全追加へフォールバックする（粗くなるが正しい）。
 */

export interface DiffLine {
  /** same=共通行 / del=旧側にのみある行 / add=新側にのみある行 */
  kind: 'same' | 'add' | 'del'
  text: string
}

/** 折り畳み表示用の行。skip は連続する共通行の省略を表す。 */
export type DiffRow = DiffLine | { kind: 'skip'; count: number }

/** LCS の DP セル数上限。超えたら全削除＋全追加へフォールバックする。 */
const LCS_CELL_LIMIT = 1_000_000

const same = (text: string): DiffLine => ({ kind: 'same', text })
const del = (text: string): DiffLine => ({ kind: 'del', text })
const add = (text: string): DiffLine => ({ kind: 'add', text })

/** oldText（現在の版）→ newText（復元する版）の行単位差分。 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  // 共通の先頭・末尾を除いて LCS の対象を最小にする（長編でも変更点は局所的なことが多い）
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return [
    ...a.slice(0, start).map(same),
    ...diffCore(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ]
}

function diffCore(a: string[], b: string[]): DiffLine[] {
  if (a.length === 0) return b.map(add)
  if (b.length === 0) return a.map(del)
  if (a.length * b.length > LCS_CELL_LIMIT) return [...a.map(del), ...b.map(add)]

  // dp[i*w+j] = a[i..] と b[j..] の LCS 長（後ろ向き DP）
  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  const at = (k: number): number => dp[k] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? at((i + 1) * w + j + 1) + 1
          : Math.max(at((i + 1) * w + j), at(i * w + j + 1))
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const la = a[i] ?? ''
    const lb = b[j] ?? ''
    if (la === lb) {
      out.push(same(la))
      i++
      j++
    } else if (at((i + 1) * w + j) >= at(i * w + j + 1)) {
      out.push(del(la))
      i++
    } else {
      out.push(add(lb))
      j++
    }
  }
  while (i < a.length) out.push(del(a[i++] ?? ''))
  while (j < b.length) out.push(add(b[j++] ?? ''))
  return out
}

/**
 * 変更行の前後 context 行だけ共通行を残し、それ以外の連続共通行を skip 行へ畳む。
 * 長編で「変更のない本文」がダイアログを埋め尽くすのを防ぐ。
 */
export function collapseUnchanged(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.kind === 'same') continue
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true
    }
  }
  const out: DiffRow[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line && keep[i]) {
      if (skipped > 0) {
        out.push({ kind: 'skip', count: skipped })
        skipped = 0
      }
      out.push(line)
    } else {
      skipped++
    }
  }
  if (skipped > 0) out.push({ kind: 'skip', count: skipped })
  return out
}
