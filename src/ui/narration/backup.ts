import {
  audioHash,
  type NarrationBackup,
  NarrationBackupSchema,
  NarrationRecordSchema,
} from '@/core/narration/backup'
import type { NarrationRecord } from '@/core/narration/types'
import { IdbStore } from '@/core/storage/idbStore'
import { NarrationRepository } from '@/core/storage/narrationRepository'
import type { KeyValueStore } from '@/core/storage/types'
import { setNarrationTransfer } from './transfer-status'

export class NarrationBackupIO {
  readonly repository: NarrationRepository
  constructor(
    readonly owner = 'local',
    private getToken?: () => Promise<string | null>,
    private store: KeyValueStore = new IdbStore('novel-studio'),
  ) {
    this.repository = new NarrationRepository(store, owner)
  }
  private async request(path: string, init?: RequestInit) {
    const token = await this.getToken?.()
    if (!token && this.owner === 'local') return fetch(path, init)
    if (!token)
      throw new Error('音声を取得できませんでした。サインインして、もう一度お試しください。')
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.sub !== this.owner)
      throw new Error('アカウントが変わりました。画面を開き直してください。')
    return fetch(path, { ...init, headers: { ...init?.headers, authorization: 'Bearer ' + token } })
  }
  async audio(takeId: string): Promise<Blob> {
    const local = await this.repository.audio(takeId)
    if (local) return local
    const hash = await this.store.get<string>('narration-audio-hash:' + this.owner + ':' + takeId)
    if (hash) {
      const saved = await this.request('/api/narration-assets?hash=' + hash)
      if (saved.ok) {
        const blob = await saved.blob()
        if ((await audioHash(new Uint8Array(await blob.arrayBuffer()))) !== hash)
          throw new Error('保存した音声を確認できませんでした。もう一度お試しください。')
        await this.repository.saveAudio(takeId, blob)
        return blob
      }
    }
    const response = await this.request(
      '/api/narration?action=audio&take=' + encodeURIComponent(takeId),
    )
    if (!response.ok)
      throw new Error(
        'バックアップに必要な音声が見つかりません。音声を保存した端末でお試しください。',
      )
    const blob = await response.blob()
    await this.repository.saveAudio(takeId, blob)
    return blob
  }
  async gather(record: NarrationRecord): Promise<NarrationBackup> {
    const parsed: NarrationBackup = {
      record: NarrationRecordSchema.parse(record),
      audio: {},
      owner: this.owner,
    }
    for (const take of record.takes) {
      let blob = await this.repository.audio(take.id)
      if (!blob && take.state === 'ready') blob = await this.audio(take.id)
      if (!blob) continue
      const cacheKey = 'narration-audio-hash:' + this.owner + ':' + take.id
      const hash =
        (await this.store.get<string>(cacheKey)) ??
        (await audioHash(new Uint8Array(await blob.arrayBuffer())))
      parsed.audio[take.id] = hash
      await this.store.set(cacheKey, hash)
    }
    parsed.pending = await this.repository.pending(record.settings.workId)
    return NarrationBackupSchema.parse(parsed)
  }
  async gatherAll(): Promise<NarrationBackup[]> {
    const out: NarrationBackup[] = []
    for (const record of await this.repository.list()) out.push(await this.gather(record))
    return out
  }
  async usage(): Promise<void> {
    const response = await this.request('/api/narration-assets')
    if (!response.ok) return
    const body = (await response.json()) as { used: number; limit: number }
    setNarrationTransfer(this.owner, body)
  }
  private uploaded = new Set<string>()
  async upload(entries: NarrationBackup[]): Promise<void> {
    if (!entries.length) return
    setNarrationTransfer(this.owner, { busy: true, error: '' })
    try {
      await this.uploadAssets(entries)
      setNarrationTransfer(this.owner, { savedAt: Date.now() })
      await this.usage()
    } catch (error) {
      setNarrationTransfer(this.owner, {
        error: error instanceof Error ? error.message : '音声をクラウドに保存できませんでした。',
      })
      throw error
    } finally {
      setNarrationTransfer(this.owner, { busy: false })
    }
  }
  private async uploadAssets(entries: NarrationBackup[]): Promise<void> {
    const done = this.uploaded
    for (const entry of entries)
      for (const [id, hash] of Object.entries(entry.audio)) {
        if (done.has(hash)) continue
        const path = '/api/narration-assets?hash=' + hash
        const exists = await this.request(path, { method: 'HEAD' })
        if (!exists.ok) {
          if (exists.status !== 404)
            throw new Error('音声をクラウドに保存できませんでした。通信環境を確認してください。')
          const blob = await this.audio(id)
          const response = await this.request(path, { method: 'PUT', body: blob })
          if (!response.ok)
            throw new Error(
              response.status === 409
                ? '朗読音声のクラウド保管が5GBに達しました。端末の音声は残っています。ファイルにバックアップできます。'
                : '音声をクラウドに保存できませんでした。もう一度お試しください。',
            )
        }
        done.add(hash)
      }
  }
  /** Validate and stage every asset before replacing any editing state. */
  async prepare(entries: NarrationBackup[], files?: Map<string, Uint8Array>): Promise<void> {
    for (const raw of entries) {
      const entry = NarrationBackupSchema.parse(raw)
      for (const [id, hash] of Object.entries(entry.audio)) {
        const local = await this.repository.audio(id)
        if (local && (await audioHash(new Uint8Array(await local.arrayBuffer()))) === hash) continue
        let bytes = files?.get(hash + '.mp3')
        if (!bytes && files)
          throw new Error(
            'バックアップに必要な音声が含まれていません。元のZIPファイルを選んでください。',
          )
        if (!bytes) {
          const response = await this.request('/api/narration-assets?hash=' + hash)
          if (!response.ok)
            throw new Error(
              '音声を復元できませんでした。通信環境を確認して、もう一度お試しください。',
            )
          bytes = new Uint8Array(await response.arrayBuffer())
        }
        if ((await audioHash(bytes)) !== hash)
          throw new Error('バックアップの音声が破損しています。別のバックアップを選んでください。')
        await this.repository.saveAudio(id, new Blob([bytes as BlobPart], { type: 'audio/mpeg' }))
      }
    }
  }
  async apply(entries: NarrationBackup[]): Promise<void> {
    for (const entry of entries) {
      for (const [id, hash] of Object.entries(entry.audio))
        await this.store.set('narration-audio-hash:' + this.owner + ':' + id, hash)
      await this.repository.save(entry.record)
      await this.repository.restorePending(
        entry.record.settings.workId,
        !entry.owner || entry.owner === this.owner ? entry.pending : undefined,
      )
    }
  }
}
