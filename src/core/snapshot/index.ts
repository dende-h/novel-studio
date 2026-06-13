import type { Work } from '../schema'

/**
 * 最小版管理。Work の深いコピーを時刻付きで保持し、復元・件数切り詰めを行う純ロジック。
 */

export interface Snapshot {
  id: string
  at: number
  work: Work
}

export function createSnapshot(work: Work, at: number, id: string): Snapshot {
  return { id, at, work: structuredClone(work) }
}

export function restoreSnapshot(snap: Snapshot): Work {
  return structuredClone(snap.work)
}

export function trimSnapshots(snaps: Snapshot[], max: number): Snapshot[] {
  return [...snaps].sort((a, b) => b.at - a.at).slice(0, Math.max(0, max))
}
