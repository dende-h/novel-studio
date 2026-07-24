import type { Work } from '../schema'
import type { KeyValueStore } from '../storage/types'
import { createSnapshot, type Snapshot, trimSnapshots } from './index'

/**
 * スナップショット履歴の永続化。KeyValueStore 上に `snap:<workId>` で
 * Snapshot[] を新しい順に保持し、max 件で切り詰める。
 */

const keyOf = (workId: string) => `snap:${workId}`
const DEFAULT_MAX = 20

export class SnapshotRepository {
  constructor(
    private store: KeyValueStore,
    private max: number = DEFAULT_MAX,
  ) {}

  /** 新しい順のスナップショット一覧。 */
  async list(workId: string): Promise<Snapshot[]> {
    const raw = await this.store.get<Snapshot[]>(keyOf(workId))
    return trimSnapshots(raw ?? [], this.max)
  }

  /** 現在の Work を履歴へ追加し、切り詰めた最新一覧を返す。 */
  async append(work: Work, at: number, id: string): Promise<Snapshot[]> {
    const existing = (await this.store.get<Snapshot[]>(keyOf(work.id))) ?? []
    const next = trimSnapshots([createSnapshot(work, at, id), ...existing], this.max)
    await this.store.set(keyOf(work.id), next)
    return next
  }

  /**
   * 集約記録。最新版が無い／`minIntervalMs` 以上前なら新しい版を追加し、
   * 連続編集中（間隔内）は最新版を合体更新（at/id 据え置きで内容のみ差し替え）して
   * 版が無数に増えるのを防ぐ。切り詰めた最新一覧を返す。
   */
  async record(work: Work, at: number, id: string, minIntervalMs: number): Promise<Snapshot[]> {
    const existing = (await this.store.get<Snapshot[]>(keyOf(work.id))) ?? []
    const latest = existing[0]
    const next =
      !latest || at - latest.at >= minIntervalMs
        ? [createSnapshot(work, at, id), ...existing]
        : [createSnapshot(work, latest.at, latest.id), ...existing.slice(1)]
    const trimmed = trimSnapshots(next, this.max)
    await this.store.set(keyOf(work.id), trimmed)
    return trimmed
  }

  async clear(workId: string): Promise<void> {
    await this.store.delete(keyOf(workId))
  }
}
