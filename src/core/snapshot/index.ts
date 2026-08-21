import type { Work } from '../schema'

/**
 * 最小版管理。Work の深いコピーを時刻付きで保持し、復元・件数切り詰めを行う純ロジック。
 */

export interface Snapshot {
  id: string
  at: number
  work: Work
  /**
   * この版が生まれたきっかけ。'edit'（保存＝既定）と 'sync'（同期で置き換わる／消える直前の退避）。
   * 履歴パネルが後者を「同期で退避」と表示し、**退避先はここ**だと分かるようにする
   * （旧データには無いので任意。無ければ 'edit' 扱い）。
   */
  origin?: 'edit' | 'sync'
}

export function createSnapshot(
  work: Work,
  at: number,
  id: string,
  origin?: 'edit' | 'sync',
): Snapshot {
  const clone = structuredClone(work)
  // 画像（表紙・図鑑サムネ）は正本（IDB の Work）にのみ持ち、版管理しない。
  // 復元は本文（episodes）しか使わないため不要で、相乗りさせると履歴が肥大する（最大版数ぶん複製される）。
  clone.coverImage = undefined
  if (clone.glossary) for (const e of clone.glossary) e.thumbnail = undefined
  return origin === 'sync' ? { id, at, work: clone, origin } : { id, at, work: clone }
}

export function restoreSnapshot(snap: Snapshot): Work {
  return structuredClone(snap.work)
}

export function trimSnapshots(snaps: Snapshot[], max: number): Snapshot[] {
  return [...snaps].sort((a, b) => b.at - a.at).slice(0, Math.max(0, max))
}
