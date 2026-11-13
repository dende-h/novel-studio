// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BackupState, deserializeBackup, serializeBackup } from '@/core/backup'
import { createBackupArchive, readBackupArchive } from '@/core/backup/archive'
import { audioHash } from '@/core/narration/backup'
import { emptyNarration } from '@/core/narration/types'
import { MemoryStore } from '@/core/storage/memoryStore'
import { createLocalBackupService } from '@/ui/backup/backup-service'
import { NarrationBackupIO } from './backup'

const empty = (): BackupState => ({
  works: [],
  trash: [],
  profile: {},
  activity: [],
  ideas: [],
  structures: [],
  plots: [],
  stagings: [],
  proofreads: [],
  nameDismissals: [],
  proofreadRules: [],
  gameAssets: [],
})
const token = async () => 'x.' + btoa(JSON.stringify({ sub: 'alice' })) + '.x'
afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const source = new NarrationBackupIO('alice', token, new MemoryStore())
  const record = emptyNarration('work')
  record.settings.cues = [
    {
      id: 'cue',
      episodeId: 'e',
      scope: 'range',
      refs: [{ blockId: 'b', snapshot: '朝。' }],
      direction: '寂しそうに',
    },
  ]
  record.settings.dictionary = [{ id: 'd', surface: '朝', reading: 'あさ' }]
  record.takes = ['old', 'candidate'].map((id) => ({
    id,
    segmentId: 's',
    fingerprint: id,
    jobId: 'j',
    state: 'ready',
    createdAt: 1,
  }))
  record.accepted = { s: 'old' }
  record.candidates = { s: 'candidate' }
  record.undo = { s: 'old' }
  await source.repository.save(record)
  await source.repository.saveAudio('old', new Blob(['first audio']))
  await source.repository.saveAudio('candidate', new Blob(['other audio']))
  await source.repository.restorePending(
    'work',
    JSON.stringify({ id: 'fixed-request', workId: 'work', segments: [] }),
  )
  return { source, record }
}
describe('朗読を含むバックアップ', () => {
  it('別端末へZIPだけで設定・候補・採用・音声・送信待ちを復元し、生成APIを呼ばない', async () => {
    const { source, record } = await fixture()
    const state = { ...empty(), narrations: await source.gatherAll() }
    const file = await createLocalBackupService(
      { gather: async () => state, replaceAll: async () => {} },
      () => 99,
      source,
    ).exportFile!()
    const target = new NarrationBackupIO('alice', token, new MemoryStore())
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    let restored: BackupState | undefined
    const service = createLocalBackupService(
      {
        gather: async () => empty(),
        replaceAll: async (s) => {
          await target.prepare(s.narrations ?? [])
          await target.apply(s.narrations ?? [])
          restored = s
        },
      },
      () => 100,
      target,
    )
    await service.restoreFile!(file.data)
    expect(restored?.narrations?.[0]?.record).toEqual(record)
    expect(await (await target.audio('old')).text()).toBe('first audio')
    expect(await (await target.audio('candidate')).text()).toBe('other audio')
    expect(await target.repository.pending('work')).toContain('fixed-request')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('同じ音声はZIPに一度だけ格納し、クラウドも再送しない', async () => {
    const { source } = await fixture()
    await source.repository.saveAudio('candidate', new Blob(['first audio']))
    const entries = await source.gatherAll()
    const remote = new Map<string, Blob>()
    const puts: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const hash = new URL(url, 'https://example.test').searchParams.get('hash')
        if (!hash) return Response.json({ used: 11, limit: 5368709120 })
        if (init?.method === 'HEAD')
          return new Response(null, { status: remote.has(hash) ? 200 : 404 })
        if (init?.method === 'PUT') {
          puts.push(hash)
          remote.set(hash, init.body as Blob)
          return Response.json({ ok: true })
        }
        return new Response(remote.get(hash), { status: remote.has(hash) ? 200 : 404 })
      }),
    )
    await source.upload(entries)
    await source.upload(entries)
    expect(puts).toHaveLength(1)
    const target = new NarrationBackupIO('alice', token, new MemoryStore())
    await target.prepare(entries)
    await target.apply(entries)
    expect(await (await target.audio('candidate')).text()).toBe('first audio')
  })
  it('音声欠落・改ざんでは復元を始めず、既存の採用を維持する', async () => {
    const { source, record } = await fixture()
    const entries = await source.gatherAll()
    const json = serializeBackup({ ...empty(), narrations: entries }, 1)
    const replaceAll = vi.fn()
    const svc = createLocalBackupService(
      { gather: async () => empty(), replaceAll },
      () => 1,
      source,
    )
    await expect(svc.restoreFile!(createBackupArchive(json, new Map()))).rejects.toThrow()
    expect(replaceAll).not.toHaveBeenCalled()
    expect((await source.repository.get('work')).accepted).toEqual(record.accepted)
    const hash = Object.values(entries[0]!.audio)[0]!
    const target = new NarrationBackupIO('alice', token, new MemoryStore())
    await expect(
      target.prepare(entries, new Map([[hash + '.mp3', new TextEncoder().encode('tampered')]])),
    ).rejects.toThrow('破損')
  })
  it('旧JSONは朗読の欄を補わず、未知の設定項目は往復で残す', () => {
    expect(deserializeBackup(serializeBackup(empty(), 1)).narrations).toBeUndefined()
    const record = { ...emptyNarration('work'), future: { retained: true } }
    const result = deserializeBackup(
      serializeBackup({ ...empty(), narrations: [{ record, audio: {} }] }, 1),
    )
    expect((result.narrations?.[0]?.record as unknown as { future: unknown }).future).toEqual({
      retained: true,
    })
  })
  it('アカウントを混ぜず、期限切れの一時音声がなくても保管先から取得する', async () => {
    const db = new MemoryStore()
    const alice = new NarrationBackupIO('alice', token, db)
    await alice.repository.save(emptyNarration('w'))
    await alice.repository.saveAudio('a', new Blob(['alice']))
    expect(await new NarrationBackupIO('bob', token, db).gatherAll()).toEqual([])
    await expect(new NarrationBackupIO('bob', token, db).audio('a')).rejects.toThrow('アカウント')
    const bytes = new TextEncoder().encode('durable')
    const hash = await audioHash(bytes)
    const entry = { record: emptyNarration('w'), audio: { remote: hash } }
    await alice.apply([entry])
    const fetch = vi.fn(async (_url: string) => new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    expect(await (await alice.audio('remote')).text()).toBe('durable')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toContain('narration-assets')
  })
  it('ZIP内の音声破損をCRCで検出する', () => {
    const zip = createBackupArchive(serializeBackup(empty(), 1), new Map())
    zip[45] = zip[45]! ^ 1
    expect(() => readBackupArchive(zip)).toThrow()
  })
})
