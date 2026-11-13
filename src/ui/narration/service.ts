import type {
  Entitlement,
  NarrationRecord,
  NarrationSettings,
  VoiceSegment,
  VoiceTake,
} from '@/core/narration/types'
import { IdbStore } from '@/core/storage/idbStore'
import { NarrationRepository } from '@/core/storage/narrationRepository'
import { withWorkMutationLock } from '@/core/storage/workMutationLock'
import { SyncLostRepository } from '@/core/sync/syncLostRepository'
import { touchSync } from '@/ui/sync/sync-touch'
import { NarrationBackupIO } from './backup'

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
  private pendingSaves = 0
  private saveFailed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshing = false
  private paused = false
  private revision = 0
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
    const record = await this.repository.get(this.workId)
    // Older versions saved takes but had no explicit candidate map.
    if (record.candidates === undefined) {
      record.candidates = {}
      for (const take of record.takes)
        if (take.state === 'ready' && record.accepted[take.segmentId] !== take.id)
          record.candidates[take.segmentId] = take.id
    }
    this.update({ record })
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
  busy() {
    return this.pendingSaves > 0 || this.state.sending || this.refreshing
  }
  replaceFromSync(record: NarrationRecord) {
    this.revision++
    this.update({ record })
  }
  private persist(record: NarrationRecord) {
    if (this.paused) return this.serial
    if (JSON.stringify(record) === JSON.stringify(this.state.record) && !this.saveFailed)
      return this.serial
    record = { ...record, updatedAt: Date.now() }
    const revision = this.revision
    this.pendingSaves++
    this.update({ record, saving: true })
    this.serial = this.serial.then(async () => {
      try {
        await withWorkMutationLock('narration:' + this.owner + ':' + this.workId, async () => {
          if (revision !== this.revision) {
            await new SyncLostRepository(new IdbStore('novel-studio')).save({
              syncId: 'narration:' + this.workId,
              at: Date.now(),
              kind: 'narration',
              reason: 'conflict',
              title: '朗読制作',
              json: JSON.stringify(record),
            })
            throw new Error(
              '別端末の変更を受け取りました。直前の編集は「同期で退避した版」に保存しました。',
            )
          }
          await this.repository.save(record)
        })
        touchSync()
        this.saveFailed = false
      } catch (error) {
        this.saveFailed = true
        this.update({
          error:
            error instanceof Error
              ? error.message
              : '端末に保存できませんでした。空き容量を確認してください。',
        })
      } finally {
        this.pendingSaves--
        this.update({ saving: this.pendingSaves > 0 })
      }
    })
    return this.serial
  }
  changeSettings(settings: NarrationSettings) {
    if (this.state.record) void this.persist({ ...this.state.record, settings })
  }
  async refresh() {
    if (this.refreshing || this.paused) return
    const revision = this.revision
    this.refreshing = true
    try {
      const body = (await (await this.api(`?work=${encodeURIComponent(this.workId)}`)).json()) as {
        entitlement: Entitlement
        jobs: string[]
        takes: VoiceTake[]
      }
      if (this.paused || revision !== this.revision) return
      for (const take of body.takes) {
        if (take.state === 'missing' && (await this.repository.audio(take.id))) take.state = 'ready'
      }
      if (this.paused || revision !== this.revision) return
      const record = this.state.record
      if (record) {
        const merged = [
          ...record.takes.filter((t) => !body.takes.some((v) => v.id === t.id)),
          ...body.takes,
        ]
        await this.persist({ ...record, takes: merged, jobs: body.jobs })
        await this.completeOperation()
        await this.applyInitialRecordings()
      }
      this.update({
        entitlement: body.entitlement,
        error: this.saveFailed ? '端末に保存できませんでした。空き容量を確認してください。' : '',
      })
      if (body.takes.some((t) => t.state === 'queued' || t.state === 'generating')) this.schedule()
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : '読み込めませんでした。' })
      this.schedule(15000)
    } finally {
      this.refreshing = false
    }
  }
  private schedule(delay = 2500) {
    if (this.paused) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), delay)
  }
  async generate(
    segments: VoiceSegment[],
    regenerate = false,
    options: { whole?: boolean; preview?: boolean; retry?: boolean } = {},
  ) {
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
      if (!pending.length) {
        if (options.whole && this.state.record) {
          const ready = segments.map((s) =>
            this.state
              .record!.takes.filter(
                (t) =>
                  t.segmentId === s.id && t.fingerprint === s.fingerprint && t.state === 'ready',
              )
              .at(-1),
          )
          if (ready.every(Boolean)) {
            for (const t of ready) await this.audio(t!.id)
            await this.persist({
              ...this.state.record,
              accepted: {
                ...this.state.record.accepted,
                ...Object.fromEntries(ready.map((t) => [t!.segmentId, t!.id])),
              },
              snapshots: { ...this.state.record.snapshots, [segments[0]!.episodeId]: segments },
            })
          }
        }
        return
      }
      const id = crypto.randomUUID()
      const previous = this.state.record?.operation
      if (this.state.record)
        await this.persist({
          ...this.state.record,
          operation: {
            segments: options.retry && previous ? previous.segments : segments,
            jobs: [
              ...(options.retry && previous ? previous.jobs : []),
              ...(!regenerate
                ? (this.state.record?.takes
                    .filter(
                      (t) =>
                        segments.some(
                          (s) => s.id === t.segmentId && s.fingerprint === t.fingerprint,
                        ) && t.state === 'ready',
                    )
                    .map((t) => t.jobId) ?? [])
                : []),
              id,
            ],
            whole: !!options.whole,
            preview: !!options.preview,
          },
        })
      const payload = JSON.stringify({
        id,
        preview: !!options.preview,
        workId: this.workId,
        segments: pending,
      })
      await this.flush()
      await db.set(key, payload)
      try {
        await this.api('', { method: 'POST', body: payload })
        await db.delete(key)
        await this.refresh()
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          await db.delete(key)
          // A rejected request never started a job; let the author correct it.
          if (this.state.record) await this.persist({ ...this.state.record, operation: previous })
        }
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

  async pauseForRestore() {
    this.paused = true
    clearTimeout(this.timer)
    await this.flush()
    this.revision++
  }
  async resumeAfterRestore() {
    this.replaceFromSync(await this.repository.get(this.workId))
    this.paused = false
  }
  async flush() {
    await this.serial
    if (this.saveFailed) throw new Error(this.state.error)
  }
  async setRecord(patch: Partial<NarrationRecord>) {
    if (this.state.record) await this.persist({ ...this.state.record, ...patch })
  }
  private async completeOperation() {
    const record = this.state.record,
      operation = record?.operation
    if (!record || !operation) return
    const takes = operation.segments.map((s) =>
      record.takes
        .filter(
          (t) =>
            operation.jobs.includes(t.jobId) &&
            t.segmentId === s.id &&
            t.fingerprint === s.fingerprint &&
            t.state === 'ready',
        )
        .at(-1),
    )
    if (takes.some((t) => !t)) return
    // Fetch every asset before atomically replacing any accepted audio.
    for (const t of takes) await this.audio(t!.id)
    const current = this.state.record!
    if (current.operation !== operation) return
    const mapping = Object.fromEntries(takes.map((t) => [t!.segmentId, t!.id]))
    if (operation.preview) {
      await this.persist({ ...current, operation: undefined })
    } else if (operation.whole) {
      const ep = operation.segments[0]!.episodeId
      await this.persist({
        ...current,
        accepted: { ...current.accepted, ...mapping },
        snapshots: { ...current.snapshots, [ep]: operation.segments },
        candidates: Object.fromEntries(
          Object.entries(current.candidates ?? {}).filter(([id]) => !mapping[id]),
        ),
        operation: undefined,
      })
    } else {
      const accepted = { ...current.accepted }
      const candidates = { ...current.candidates }
      const candidateSegments = { ...current.candidateSegments }
      const snapshots = { ...current.snapshots }
      for (const segment of operation.segments) {
        // A first recording has nothing to compare. Preserve any existing adoption,
        // even when its asset has expired; replacing it still requires a choice.
        if (!accepted[segment.id]) {
          accepted[segment.id] = mapping[segment.id]!
          delete candidates[segment.id]
          const snapshot = snapshots[segment.episodeId]
          if (snapshot?.some((s) => s.id === segment.id))
            snapshots[segment.episodeId] = snapshot.map((s) => (s.id === segment.id ? segment : s))
        } else {
          candidates[segment.id] = mapping[segment.id]!
          candidateSegments[segment.id] = segment
        }
      }
      await this.persist({
        ...current,
        accepted,
        candidates,
        candidateSegments,
        snapshots,
        operation: undefined,
      })
    }
  }
  private async applyInitialRecordings() {
    const record = this.state.record
    if (!record || record.operation) return
    // Only explicit partial-generation candidates qualify. Preview/cache takes
    // and historical inferred candidates have no candidateSegments snapshot.
    const initial = Object.entries(record.candidates ?? {}).filter(
      ([id, takeId]) =>
        !record.accepted[id] &&
        record.candidateSegments?.[id] &&
        record.takes.some((t) => t.id === takeId && t.state === 'ready'),
    )
    if (!initial.length) return
    for (const [, takeId] of initial) await this.audio(takeId)
    if (this.state.record !== record) return
    const accepted = { ...record.accepted }
    const candidates = { ...record.candidates }
    const snapshots = { ...record.snapshots }
    for (const [id, takeId] of initial) {
      accepted[id] = takeId
      delete candidates[id]
      const segment = record.candidateSegments![id]!
      const snapshot = snapshots[segment.episodeId]
      if (snapshot?.some((s) => s.id === id))
        snapshots[segment.episodeId] = snapshot.map((s) => (s.id === id ? segment : s))
    }
    await this.persist({ ...record, accepted, candidates, snapshots })
  }
  async adopt(segments: VoiceSegment[], useNew: boolean) {
    const record = this.state.record
    if (!record) return
    const accepted = { ...record.accepted },
      candidates = { ...record.candidates }
    const undo = { ...record.accepted }
    for (const s of segments) {
      const id = candidates[s.id]
      if (useNew && id) {
        await this.audio(id)
        accepted[s.id] = id
      }
      delete candidates[s.id]
    }
    const ep = segments[0]?.episodeId
    const old = ep ? (record.snapshots?.[ep] ?? []) : []
    const snapshots = { ...record.snapshots }
    if (ep && useNew && old.length)
      snapshots[ep] = old.length
        ? old.map((s) =>
            segments.some((v) => v.id === s.id) && record.candidateSegments?.[s.id]
              ? record.candidateSegments[s.id]!
              : s,
          )
        : segments
    await this.persist({
      ...this.state.record!,
      accepted,
      candidates,
      undo,
      snapshots,
      undoSnapshots: record.snapshots,
    })
  }
  async undoAdoption() {
    const record = this.state.record
    if (record?.undo)
      await this.persist({
        ...record,
        accepted: record.undo,
        snapshots: record.undoSnapshots ?? record.snapshots,
        undo: undefined,
        undoSnapshots: undefined,
      })
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
    return new NarrationBackupIO(this.owner, this.getToken).audio(id)
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

export function narrationBusy(owner: string, workId: string): boolean {
  return services.get(owner + ':' + workId)?.busy() ?? false
}
export function reloadNarration(owner: string, workId: string, record: NarrationRecord): void {
  services.get(owner + ':' + workId)?.replaceFromSync(record)
}

export async function pauseNarrations(owner: string): Promise<void> {
  for (const [key, service] of services)
    if (key.startsWith(owner + ':')) await service.pauseForRestore()
}
export async function resumeNarrations(owner: string): Promise<void> {
  for (const [key, service] of services)
    if (key.startsWith(owner + ':')) await service.resumeAfterRestore()
}
