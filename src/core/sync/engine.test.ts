import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import type { PullResult, PushPayload, SyncDeps } from './engine'
import { runAutosavePush, runLoginSync } from './engine'
import type { LocalSyncMeta, ManifestEntry } from './manifest'
import { splitWork } from './split'

// 決定論ハッシュ（canonicalize 相当は使わず、構造の差だけ見られればよい）。
const fakeHash = (v: unknown) => JSON.stringify(v)
function digestOf(work: Work) {
  const { doc, media } = splitWork(work)
  return { docHash: fakeHash(doc), mediaHash: media === null ? '' : fakeHash(media) }
}

const mkWork = (id: string, over: Partial<Work> = {}): Work => ({
  id,
  title: 'T',
  episodes: [],
  updatedAt: 100,
  ...over,
})

function remoteOf(work: Work, opts: { deleted?: boolean } = {}) {
  const deleted = opts.deleted ?? false
  const d = digestOf(work)
  const entry: ManifestEntry = {
    workId: work.id,
    updatedAt: work.updatedAt ?? 0,
    deleted,
    docHash: deleted ? '' : d.docHash,
    mediaHash: deleted ? '' : d.mediaHash,
    size: 1,
  }
  const { doc, media } = splitWork(work)
  const data: PullResult = { doc, media, updatedAt: work.updatedAt ?? 0 }
  return { entry, data }
}

interface Calls {
  pushed: Array<{ workId: string; parts: PushPayload['parts'] }>
  pulled: string[]
  saved: Work[]
  snapshotted: string[]
  trashed: string[]
}

function makeDeps(locals: Work[], remotes: Array<{ entry: ManifestEntry; data: PullResult }>) {
  const localWorks = new Map(locals.map((w) => [w.id, structuredClone(w)]))
  const remoteEntries = remotes.map((r) => r.entry)
  const remoteData = new Map(remotes.map((r) => [r.entry.workId, r.data]))
  const serverHashes = new Map(
    remoteEntries.map((e) => [e.workId, { docHash: e.docHash, mediaHash: e.mediaHash }]),
  )
  const syncMeta = new Map<string, LocalSyncMeta>()
  const calls: Calls = { pushed: [], pulled: [], saved: [], snapshotted: [], trashed: [] }

  const deps: SyncDeps = {
    async getManifest() {
      return remoteEntries
    },
    async pullWork(workId) {
      calls.pulled.push(workId)
      return remoteData.get(workId) ?? null
    },
    async pushWork(workId, payload) {
      calls.pushed.push({ workId, parts: payload.parts })
      const prev = serverHashes.get(workId) ?? { docHash: '', mediaHash: '' }
      let docHash = prev.docHash
      let mediaHash = prev.mediaHash
      if (payload.parts.includes('doc')) docHash = fakeHash(payload.doc)
      if (payload.parts.includes('media')) {
        mediaHash = payload.media === null ? '' : fakeHash(payload.media)
      }
      serverHashes.set(workId, { docHash, mediaHash })
      return { docHash, mediaHash, size: 1 }
    },
    async listLocalWorks() {
      return [...localWorks.values()]
    },
    async loadLocalWork(workId) {
      const w = localWorks.get(workId)
      return w ? structuredClone(w) : null
    },
    async saveLocalWork(work) {
      localWorks.set(work.id, structuredClone(work))
      calls.saved.push(structuredClone(work))
    },
    async trashLocalWork(workId) {
      localWorks.delete(workId)
      calls.trashed.push(workId)
    },
    async snapshotLocal(work) {
      calls.snapshotted.push(work.id)
    },
    async getSyncMeta(workId) {
      return syncMeta.get(workId) ?? null
    },
    async setSyncMeta(meta) {
      syncMeta.set(meta.workId, structuredClone(meta))
    },
    async hashPart(value) {
      return fakeHash(value)
    },
    now() {
      return 9999
    },
  }

  return { deps, calls, syncMeta, localWorks }
}

describe('runLoginSync', () => {
  it('ローカルのみの Work は push し、同期メタを記録する', async () => {
    const w1 = mkWork('w1')
    const { deps, calls, syncMeta } = makeDeps([w1], [])
    const res = await runLoginSync(deps)

    expect(res.pushed).toEqual(['w1'])
    expect(res.pulled).toEqual([])
    expect(res.trashed).toEqual([])
    expect(calls.pushed).toEqual([{ workId: 'w1', parts: ['doc'] }])
    expect(syncMeta.get('w1')?.docHash).toBe(fakeHash(splitWork(w1).doc))
    expect(syncMeta.get('w1')?.syncedAt).toBe(9999)
  })

  it('media を持つ Work は doc と media の両パートを push する', async () => {
    const wm = mkWork('wm', { coverImage: 'data:image/png;base64,AAAA' })
    const { deps, calls } = makeDeps([wm], [])
    await runLoginSync(deps)
    expect(calls.pushed).toEqual([{ workId: 'wm', parts: ['doc', 'media'] }])
  })

  it('リモートのみ（生存）の Work は pull して保存する', async () => {
    const remoteWork = mkWork('w2', { title: 'Remote', updatedAt: 200 })
    const { deps, calls } = makeDeps([], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res.pulled).toEqual(['w2'])
    expect(calls.saved).toHaveLength(1)
    expect(calls.saved[0]).toEqual(remoteWork)
  })

  it('両方あり・リモートが新しく内容が違う → pull＋上書き前にスナップショット退避', async () => {
    const local = mkWork('w3', { title: 'Local', updatedAt: 100 })
    const remoteWork = mkWork('w3', { title: 'Remote', updatedAt: 200 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res.pulled).toEqual(['w3'])
    expect(calls.snapshotted).toEqual(['w3'])
    expect(calls.saved[0]?.title).toBe('Remote')
  })

  it('両方あり・ローカルが新しい → push（退避なし）', async () => {
    const local = mkWork('w4', { title: 'Local', updatedAt: 300 })
    const remoteWork = mkWork('w4', { title: 'Remote', updatedAt: 100 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res.pushed).toEqual(['w4'])
    expect(calls.snapshotted).toEqual([])
    expect(calls.pulled).toEqual([])
  })

  it('両方あり・内容一致 → 何もしない（noop）', async () => {
    const w5 = mkWork('w5', { updatedAt: 100 })
    const { deps, calls } = makeDeps([w5], [remoteOf(w5)])
    const res = await runLoginSync(deps)

    expect(res).toEqual({ pulled: [], pushed: [], trashed: [] })
    expect(calls.pushed).toEqual([])
    expect(calls.pulled).toEqual([])
  })

  it('リモート削除済み・ローカルが古い → ローカルもゴミ箱へ（削除伝播）', async () => {
    const local = mkWork('w6', { updatedAt: 100 })
    const remoteWork = mkWork('w6', { updatedAt: 200 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork, { deleted: true })])
    const res = await runLoginSync(deps)

    expect(res.trashed).toEqual(['w6'])
    expect(calls.trashed).toEqual(['w6'])
    expect(calls.pulled).toEqual([])
  })

  it('リモート削除済み・ローカルが新しい → push で復活', async () => {
    const local = mkWork('w7', { updatedAt: 300 })
    const remoteWork = mkWork('w7', { updatedAt: 100 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork, { deleted: true })])
    const res = await runLoginSync(deps)

    expect(res.pushed).toEqual(['w7'])
    expect(calls.trashed).toEqual([])
  })

  it('リモートのみ・削除済み → 何もしない', async () => {
    const remoteWork = mkWork('w8', { updatedAt: 200 })
    const { deps, calls } = makeDeps([], [remoteOf(remoteWork, { deleted: true })])
    const res = await runLoginSync(deps)

    expect(res).toEqual({ pulled: [], pushed: [], trashed: [] })
    expect(calls.pulled).toEqual([])
  })
})

describe('runAutosavePush', () => {
  it('doc だけ変わっていれば doc パートのみ push する', async () => {
    const work = mkWork('w1', { coverImage: 'data:image/png;base64,AAAA', title: '改題' })
    const { deps, calls, syncMeta } = makeDeps([work], [])
    // 直近同期メタ：media は現物と同じ、doc は異なる。
    const cur = digestOf(work)
    syncMeta.set('w1', {
      workId: 'w1',
      docHash: 'stale-doc',
      mediaHash: cur.mediaHash,
      syncedAt: 1,
    })

    const ok = await runAutosavePush(deps, 'w1')
    expect(ok).toBe(true)
    expect(calls.pushed).toEqual([{ workId: 'w1', parts: ['doc'] }])
  })

  it('変化がなければ push しない（false）', async () => {
    const work = mkWork('w1')
    const { deps, calls, syncMeta } = makeDeps([work], [])
    const cur = digestOf(work)
    syncMeta.set('w1', { workId: 'w1', ...cur, syncedAt: 1 })

    const ok = await runAutosavePush(deps, 'w1')
    expect(ok).toBe(false)
    expect(calls.pushed).toEqual([])
  })

  it('同期メタが無ければ（初回）doc を push し、メタを記録する', async () => {
    const work = mkWork('w1')
    const { deps, calls, syncMeta } = makeDeps([work], [])
    const ok = await runAutosavePush(deps, 'w1')
    expect(ok).toBe(true)
    expect(calls.pushed).toEqual([{ workId: 'w1', parts: ['doc'] }])
    expect(syncMeta.get('w1')?.syncedAt).toBe(9999)
  })

  it('ローカルに無い workId は false', async () => {
    const { deps, calls } = makeDeps([], [])
    expect(await runAutosavePush(deps, 'nope')).toBe(false)
    expect(calls.pushed).toEqual([])
  })
})
