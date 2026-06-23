import type { LocalSyncMeta } from '../sync/manifest'
import type { KeyValueStore } from './types'

/**
 * 同期メタの永続化（Phase 2）。「最後にサーバと一致させた状態」を Work ごとに保持し、
 * autosave push の差分判定に使う。鍵は `syncmeta:<userId>:<workId>`（ユーザー単位で分離）。
 */

const keyOf = (userId: string, workId: string) => `syncmeta:${userId}:${workId}`
const prefixOf = (userId: string) => `syncmeta:${userId}:`

export class SyncMetaRepository {
  constructor(
    private store: KeyValueStore,
    private userId: string,
  ) {}

  async get(workId: string): Promise<LocalSyncMeta | null> {
    return (await this.store.get<LocalSyncMeta>(keyOf(this.userId, workId))) ?? null
  }

  async set(meta: LocalSyncMeta): Promise<void> {
    await this.store.set(keyOf(this.userId, meta.workId), meta)
  }

  async delete(workId: string): Promise<void> {
    await this.store.delete(keyOf(this.userId, workId))
  }

  /** このユーザーの全同期メタを破棄（サインアウト時などに）。 */
  async clearAll(): Promise<void> {
    const keys = await this.store.keys(prefixOf(this.userId))
    await Promise.all(keys.map((k) => this.store.delete(k)))
  }
}
