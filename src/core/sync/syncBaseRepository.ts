import type { KeyValueStore } from '../storage/types'
import type { SyncBase } from './types'

/**
 * 同期 base（最後に同期した時点の記録）の永続化。KeyValueStore 上に
 * `syncbase:<workId>` で 1 作品 1 レコード保持する。三方向差分の base であり、
 * これが消えると当該作品は「新品の端末」として再同期される（復元後は clearAll する）。
 */

const keyOf = (workId: string) => `syncbase:${workId}`

export class SyncBaseRepository {
  constructor(private store: KeyValueStore) {}

  async get(workId: string): Promise<SyncBase | undefined> {
    return this.store.get<SyncBase>(keyOf(workId))
  }

  async list(): Promise<SyncBase[]> {
    const keys = await this.store.keys('syncbase:')
    const records = await Promise.all(keys.map((k) => this.store.get<SyncBase>(k)))
    return records.filter((r): r is SyncBase => r !== undefined)
  }

  async set(base: SyncBase): Promise<void> {
    await this.store.set(keyOf(base.workId), base)
  }

  async delete(workId: string): Promise<void> {
    await this.store.delete(keyOf(workId))
  }

  /** 全 base を削除する。復元（replaceAll）後に呼ぶ＝端末を「新品」として再同期。 */
  async clearAll(): Promise<void> {
    const keys = await this.store.keys('syncbase:')
    await Promise.all(keys.map((k) => this.store.delete(k)))
  }
}
