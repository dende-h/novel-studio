import { type Work, WorkSchema } from '../schema'
import type { KeyValueStore } from './types'

/**
 * Work の永続化リポジトリ。KeyValueStore 上に `work:<id>` で保存し、
 * 入出力で WorkSchema 検証して破損データを弾く。
 */

const keyOf = (id: string) => `work:${id}`

export interface WorkSummary {
  id: string
  title: string
}

export class WorkRepository {
  constructor(private store: KeyValueStore) {}

  async saveWork(work: Work): Promise<void> {
    await this.store.set(keyOf(work.id), WorkSchema.parse(work))
  }

  async getWork(id: string): Promise<Work | undefined> {
    const raw = await this.store.get(keyOf(id))
    return raw === undefined ? undefined : WorkSchema.parse(raw)
  }

  async listWorks(): Promise<WorkSummary[]> {
    const keys = await this.store.keys('work:')
    const works = await Promise.all(keys.map((k) => this.store.get(k)))
    return works.map((w) => {
      const parsed = WorkSchema.parse(w)
      return { id: parsed.id, title: parsed.title }
    })
  }

  async deleteWork(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }
}
