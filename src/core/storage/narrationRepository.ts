import { emptyNarration, type NarrationRecord } from '../narration/types'
import type { KeyValueStore } from './types'
export class NarrationRepository {
  constructor(
    private store: KeyValueStore,
    private owner = 'local',
  ) {}
  async list(): Promise<NarrationRecord[]> {
    const keys = await this.store.keys('narration:' + this.owner + ':')
    const rows = await Promise.all(keys.map((key) => this.store.get<NarrationRecord>(key)))
    return rows.filter((row): row is NarrationRecord => !!row)
  }
  async pending(workId: string): Promise<string | undefined> {
    return this.store.get<string>('narration-pending:' + this.owner + ':' + workId)
  }
  async restorePending(workId: string, pending?: string): Promise<void> {
    const key = 'narration-pending:' + this.owner + ':' + workId
    if (pending) await this.store.set(key, pending)
    else await this.store.delete(key)
  }
  async get(workId: string): Promise<NarrationRecord> {
    return (
      (await this.store.get<NarrationRecord>(`narration:${this.owner}:${workId}`)) ??
      emptyNarration(workId)
    )
  }
  async replaceAll(records: NarrationRecord[]): Promise<void> {
    const keep = new Set(records.map((record) => record.settings.workId))
    for (const row of await this.list())
      if (!keep.has(row.settings.workId)) {
        await this.store.delete('narration:' + this.owner + ':' + row.settings.workId)
        await this.restorePending(row.settings.workId)
      }
    for (const record of records) await this.save(record)
  }
  save(record: NarrationRecord): Promise<void> {
    return this.store.set(`narration:${this.owner}:${record.settings.workId}`, record)
  }
  saveAudio(id: string, blob: Blob): Promise<void> {
    return this.store.set(`narration-audio:${this.owner}:${id}`, blob)
  }
  audio(id: string): Promise<Blob | undefined> {
    return this.store.get<Blob>(`narration-audio:${this.owner}:${id}`)
  }
}
