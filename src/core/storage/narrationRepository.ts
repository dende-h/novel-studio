import { emptyNarration, type NarrationRecord } from '../narration/types'
import type { KeyValueStore } from './types'
export class NarrationRepository {
  constructor(
    private store: KeyValueStore,
    private owner = 'local',
  ) {}
  async get(workId: string): Promise<NarrationRecord> {
    return (
      (await this.store.get<NarrationRecord>(`narration:${this.owner}:${workId}`)) ??
      emptyNarration(workId)
    )
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
