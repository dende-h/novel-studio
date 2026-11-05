import type {
  Entitlement,
  NarrationRecord,
  NarrationSettings,
  VoiceSegment,
  VoiceTake,
} from '@/core/narration/types'
import { IdbStore } from '@/core/storage/idbStore'
import { NarrationRepository } from '@/core/storage/narrationRepository'

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
export interface StudioState {
  record: NarrationRecord | null
  entitlement: Entitlement | null
  error: string
  saving: boolean
  sending: boolean
}
export class NarrationService {
  private repository: NarrationRepository
  private state: StudioState = {
    record: null,
    entitlement: null,
    error: '',
    saving: false,
    sending: false,
  }
  private listeners = new Set<() => void>()
  private serial = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshing = false
  constructor(
    private workId: string,
    private getToken: () => Promise<string | null>,
    private owner = 'local',
  ) {
    this.repository = new NarrationRepository(new IdbStore('novel-studio'), owner)
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.state
  private update(patch: Partial<StudioState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  async init() {
    this.update({ record: await this.repository.get(this.workId) })
    await this.refresh()
  }
  private async api(query: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken()
    if (token && this.owner !== 'local') {
      try {
        if (
          JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).sub !==
          this.owner
        )
          throw new Error()
      } catch {
        throw new Error('アカウントが変わりました。朗読制作を開き直してください。')
      }
    }
    const response = await fetch(`/api/narration${query}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(
        body.error || '通信できませんでした。時間をおいてお試しください。',
        response.status,
      )
    }
    return response
  }
  private persist(record: NarrationRecord) {
    this.update({ record, saving: true })
    this.serial = this.serial
      .then(() => this.repository.save(record))
      .then(() => this.update({ saving: false }))
      .catch(() =>
        this.update({
          saving: false,
          error: '端末に保存できませんでした。空き容量を確認してください。',
        }),
      )
    return this.serial
  }
  changeSettings(settings: NarrationSettings) {
    if (this.state.record) void this.persist({ ...this.state.record, settings })
  }
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const body = (await (await this.api(`?work=${encodeURIComponent(this.workId)}`)).json()) as {
        entitlement: Entitlement
        jobs: string[]
        takes: VoiceTake[]
      }
      for (const take of body.takes) {
        if (take.state === 'missing' && (await this.repository.audio(take.id))) take.state = 'ready'
      }
      const record = this.state.record
      if (record) await this.persist({ ...record, takes: body.takes, jobs: body.jobs })
      this.update({ entitlement: body.entitlement, error: '' })
      if (body.takes.some((t) => t.state === 'queued' || t.state === 'generating')) this.schedule()
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : '読み込めませんでした。' })
      this.schedule(15000)
    } finally {
      this.refreshing = false
    }
  }
  private schedule(delay = 2500) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), delay)
  }
  async generate(segments: VoiceSegment[], regenerate = false) {
    if (this.state.sending || !segments.length) return
    this.update({ sending: true, error: '' })
    const submit = async () => {
      const db = new IdbStore('novel-studio')
      const key = `narration-pending:${this.owner}:${this.workId}`
      const existing = await db.get<string>(key)
      if (existing) {
        await this.retryPending()
        return
      }
      await this.refresh()
      const pending = regenerate
        ? segments
        : segments.filter(
            (s) =>
              !this.state.record?.takes.some(
                (t) =>
                  t.segmentId === s.id &&
                  t.fingerprint === s.fingerprint &&
                  ['queued', 'generating', 'ready'].includes(t.state),
              ),
          )
      if (!pending.length) return
      const payload = JSON.stringify({
        id: crypto.randomUUID(),
        workId: this.workId,
        segments: pending,
      })
      await db.set(key, payload)
      try {
        await this.api('', { method: 'POST', body: payload })
        await db.delete(key)
        await this.refresh()
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500)
          await db.delete(key)
        throw error
      }
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.locks)
        await navigator.locks.request(`narration:${this.owner}:${this.workId}`, submit)
      else await submit()
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : '生成を開始できませんでした。',
      })
    } finally {
      this.update({ sending: false })
    }
  }
  async retryPending() {
    const payload = await new IdbStore('novel-studio').get<string>(
      `narration-pending:${this.owner}:${this.workId}`,
    )
    if (!payload) return
    await this.api('', { method: 'POST', body: payload })
    await new IdbStore('novel-studio').delete(`narration-pending:${this.owner}:${this.workId}`)
    await this.refresh()
  }
  async cancel(jobId: string) {
    await this.api('', { method: 'PATCH', body: JSON.stringify({ id: jobId }) })
    await this.refresh()
  }
  async accept(take: VoiceTake) {
    if (take.state !== 'ready' || !this.state.record) return
    await this.audio(take.id)
    await this.persist({
      ...this.state.record,
      accepted: { ...this.state.record.accepted, [take.segmentId]: take.id },
    })
  }
  async audio(id: string): Promise<Blob> {
    const local = await this.repository.audio(id)
    if (local) return local
    const blob = await (await this.api(`?action=audio&take=${encodeURIComponent(id)}`)).blob()
    await this.repository.saveAudio(id, blob)
    return blob
  }
}
const services = new Map<string, NarrationService>()
export function narrationService(
  workId: string,
  getToken: () => Promise<string | null>,
  owner = 'local',
) {
  const key = `${owner}:${workId}`
  let service = services.get(key)
  if (!service) {
    service = new NarrationService(workId, getToken, owner)
    services.set(key, service)
    void service.init()
  }
  return service
}
