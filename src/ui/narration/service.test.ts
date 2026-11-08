import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSegments } from '@/core/narration/resolve'
import { emptyNarration, type VoiceSegment, type VoiceTake } from '@/core/narration/types'
import { parseEpisodeBody } from '@/core/parser/parseNotation'

const memory = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/core/storage/idbStore', () => ({
  IdbStore: class {
    async get(k: string) {
      return memory.get(k)
    }
    async set(k: string, v: unknown) {
      memory.set(k, structuredClone(v))
    }
    async delete(k: string) {
      memory.delete(k)
    }
  },
}))

import { NarrationService } from './service'

afterEach(() => {
  vi.unstubAllGlobals()
  memory.clear()
})
describe('朗読の保存と生成', () => {
  it('一話再生成の失敗時は旧音声を保持し、再試行は成功済み区間を使って一括採用する', async () => {
    const episode = { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') }
    const base = emptyNarration('w')
    const segments = resolveSegments(episode, base.settings)
    const old = segments.map((s, i) => ({
      id: 'old' + i,
      segmentId: s.id,
      fingerprint: s.fingerprint,
      jobId: 'old',
      state: 'ready' as const,
      createdAt: 1,
    }))
    base.takes = old
    base.accepted = Object.fromEntries(old.map((t) => [t.segmentId, t.id]))
    base.snapshots = { e: segments }
    memory.set('narration:local:w', base)
    const takes: VoiceTake[] = [...old]
    const posts: { segments: VoiceSegment[]; id: string; preview: boolean }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('action=audio')) return new Response(new Blob(['mp3']))
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          posts.push(body)
          body.segments.forEach((s: VoiceSegment, i: number) => {
            takes.push({
              id: body.id + i,
              segmentId: s.id,
              fingerprint: s.fingerprint,
              jobId: body.id,
              state: posts.length === 1 && i === 1 ? 'failed' : 'ready',
              createdAt: posts.length + 1,
            })
          })
          return Response.json({ id: body.id })
        }
        return Response.json({ entitlement: {}, jobs: posts.map((p) => p.id), takes })
      }),
    )
    const service = new NarrationService('w', async () => null)
    await service.init()
    await service.generate(segments, true, { whole: true })
    expect(service.getSnapshot().record?.accepted).toEqual(base.accepted)
    expect(service.getSnapshot().record?.operation).toBeDefined()
    await service.generate([segments[1]!], true, { whole: true, retry: true })
    expect(posts[1]?.segments).toHaveLength(1)
    expect(service.getSnapshot().record?.operation).toBeUndefined()
    expect(
      Object.values(service.getSnapshot().record!.accepted).every((id) => !id.startsWith('old')),
    ).toBe(true)
    const restored = new NarrationService('w', async () => null)
    await restored.init()
    expect(restored.getSnapshot().record?.accepted).toEqual(service.getSnapshot().record?.accepted)
  })
  it('候補は採用前に既存音声を置換せず、元の読みの採用は生成を呼ばない', async () => {
    const record = emptyNarration('w')
    const segments = resolveSegments(
      { id: 'e', title: '話', blocks: parseEpisodeBody('ありがとう。') },
      record.settings,
    )
    const old: VoiceTake = {
      id: 'old',
      segmentId: segments[0]!.id,
      fingerprint: 'old',
      jobId: 'before',
      state: 'ready',
      createdAt: 1,
    }
    record.accepted = { [old.segmentId]: old.id }
    record.takes = [old]
    record.snapshots = { e: segments }
    memory.set('narration:local:w', record)
    let posts = 0
    const takes = [old]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('action=audio')) return new Response(new Blob(['mp3']))
        if (init?.method === 'POST') {
          posts++
          const body = JSON.parse(init.body as string)
          takes.push({ ...old, id: 'new', jobId: body.id, fingerprint: segments[0]!.fingerprint })
          return Response.json({ id: body.id })
        }
        return Response.json({ entitlement: {}, jobs: [], takes })
      }),
    )
    const service = new NarrationService('w', async () => null)
    await service.init()
    await service.generate(segments, true)
    expect(service.getSnapshot().record?.accepted[old.segmentId]).toBe('old')
    expect(service.getSnapshot().record?.candidates?.[old.segmentId]).toBe('new')
    await service.adopt(segments, false)
    expect(posts).toBe(1)
    expect(service.getSnapshot().record?.accepted[old.segmentId]).toBe('old')
    expect(service.getSnapshot().record?.candidates).toEqual({})
  })
})

it('APIで拒否された要求は未完了ジョブとして残さず、指示を直して再生成できる', async () => {
  const record = emptyNarration('w')
  const segments = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('こんにちは。') },
    record.settings,
  )
  memory.set('narration:local:w', record)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ error: '入力を確認してください。' }, { status: 400 })
        : Response.json({ entitlement: {}, jobs: [], takes: [] }),
    ),
  )
  const service = new NarrationService('w', async () => null)
  await service.init()
  await service.generate(segments, true)
  expect(service.getSnapshot().record?.operation).toBeUndefined()
  expect(service.getSnapshot().error).toContain('入力を確認')
  expect(memory.has('narration-pending:local:w')).toBe(false)
})

it.each([
  false,
  true,
])('初回部分生成は自動反映し、既存音声との混在でも比較は再生成部分だけにする（混在=%s）', async (mixed) => {
  const record = emptyNarration('w')
  const segments = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') },
    record.settings,
  )
  const first = segments[0]!
  const old: VoiceTake = {
    id: 'old',
    segmentId: first.id,
    fingerprint: 'before',
    jobId: 'old-job',
    state: 'ready',
    createdAt: 1,
  }
  if (mixed) {
    record.accepted[first.id] = old.id
    record.takes = [old]
  }
  memory.set('narration:local:w', record)
  const takes = [...record.takes]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('action=audio')) return new Response(new Blob(['mp3']))
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        body.segments.forEach((s: VoiceSegment, i: number) => {
          takes.push({
            id: 'new' + i,
            segmentId: s.id,
            fingerprint: s.fingerprint,
            jobId: body.id,
            state: 'ready',
            createdAt: 2,
          })
        })
        return Response.json({ id: body.id })
      }
      return Response.json({ entitlement: {}, jobs: [], takes })
    }),
  )
  const service = new NarrationService('w', async () => null)
  await service.init()
  await service.generate(segments, true)
  expect(service.getSnapshot().record?.accepted).toEqual({
    [first.id]: mixed ? 'old' : 'new0',
    [segments[1]!.id]: 'new1',
  })
  expect(service.getSnapshot().record?.candidates).toEqual(mixed ? { [first.id]: 'new0' } : {})
  const restored = new NarrationService('w', async () => null)
  await restored.init()
  expect(restored.getSnapshot().record?.accepted).toEqual(service.getSnapshot().record?.accepted)
  if (mixed) {
    await restored.adopt(segments, false)
    expect(restored.getSnapshot().record?.accepted[segments[1]!.id]).toBe('new1')
  }
})

it('無料の冒頭試聴は初回でも本文に反映しない', async () => {
  const record = emptyNarration('w')
  const segments = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('朝。') },
    record.settings,
  )
  memory.set('narration:local:w', record)
  const takes: VoiceTake[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('action=audio')) return new Response(new Blob(['mp3']))
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        takes.push({
          id: 'preview',
          segmentId: segments[0]!.id,
          fingerprint: segments[0]!.fingerprint,
          jobId: body.id,
          state: 'ready',
          createdAt: 1,
        })
        return Response.json({ id: body.id })
      }
      return Response.json({ entitlement: {}, jobs: [], takes })
    }),
  )
  const service = new NarrationService('w', async () => null)
  await service.init()
  await service.generate(segments, true, { preview: true })
  expect(service.getSnapshot().record?.accepted).toEqual({})
  expect(service.getSnapshot().record?.candidates ?? {}).toEqual({})
})

it('旧UIの初回候補を復元すると自動反映し、試聴キャッシュは残す', async () => {
  const record = emptyNarration('w')
  const segments = resolveSegments(
    { id: 'e', title: '話', blocks: parseEpisodeBody('朝。夜。') },
    record.settings,
  )
  record.takes = segments.map((s, i) => ({
    id: 'take' + i,
    segmentId: s.id,
    fingerprint: s.fingerprint,
    jobId: 'job' + i,
    state: 'ready',
    createdAt: 1,
  }))
  record.candidates = { [segments[0]!.id]: 'take0' }
  record.candidateSegments = { [segments[0]!.id]: segments[0]! }
  memory.set('narration:local:w', record)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('action=audio')
        ? new Response(new Blob(['mp3']))
        : Response.json({ entitlement: {}, jobs: [], takes: record.takes }),
    ),
  )
  const service = new NarrationService('w', async () => null)
  await service.init()
  expect(service.getSnapshot().record?.accepted).toEqual({ [segments[0]!.id]: 'take0' })
  expect(service.getSnapshot().record?.candidates).toEqual({})
  expect(service.getSnapshot().record?.takes).toHaveLength(2)
})
