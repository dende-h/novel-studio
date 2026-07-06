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
  trashed: Array<{ workId: string; trashedAt: number }>
  restored: string[]
  trashPushed: Array<{ workId: string; trashed: boolean; updatedAt: number }>
}

function makeDeps(
  locals: Work[],
  remotes: Array<{ entry: ManifestEntry; data: PullResult }>,
  trashedLocals: Array<{ workId: string; trashedAt: number }> = [],
) {
  const localWorks = new Map(locals.map((w) => [w.id, structuredClone(w)]))
  const localTrash = new Map(trashedLocals.map((t) => [t.workId, t.trashedAt]))
  const remoteEntries = remotes.map((r) => r.entry)
  const remoteData = new Map(remotes.map((r) => [r.entry.workId, r.data]))
  const serverHashes = new Map(
    remoteEntries.map((e) => [e.workId, { docHash: e.docHash, mediaHash: e.mediaHash }]),
  )
  const syncMeta = new Map<string, LocalSyncMeta>()
  const calls: Calls = {
    pushed: [],
    pulled: [],
    saved: [],
    snapshotted: [],
    trashed: [],
    restored: [],
    trashPushed: [],
  }

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
    async listLocalTrashed() {
      return [...localTrash.entries()].map(([workId, trashedAt]) => ({ workId, trashedAt }))
    },
    async loadLocalWork(workId) {
      const w = localWorks.get(workId)
      return w ? structuredClone(w) : null
    },
    async saveLocalWork(work) {
      localWorks.set(work.id, structuredClone(work))
      calls.saved.push(structuredClone(work))
    },
    async trashLocalWork(workId, trashedAt) {
      localWorks.delete(workId)
      localTrash.set(workId, trashedAt)
      calls.trashed.push({ workId, trashedAt })
    },
    async restoreLocalWork(work) {
      localWorks.set(work.id, structuredClone(work))
      localTrash.delete(work.id)
      calls.restored.push(work.id)
    },
    async pushTrashState(workId, body) {
      calls.trashPushed.push({ workId, ...body })
      return true
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

// バックアップ専用（一方向 push・自動 pull なし）。ローカルを正本に、クラウドへ push するだけ。
const EMPTY = { pulled: [], pushed: [], trashed: [], restored: [], trashPropagated: [] }

describe('runLoginSync（クラウドバックアップ＝一方向 push・自動 pull なし）', () => {
  it('ローカルのみの Work は push（バックアップ）し同期メタを記録する', async () => {
    const w1 = mkWork('w1')
    const { deps, calls, syncMeta } = makeDeps([w1], [])
    const res = await runLoginSync(deps)

    expect(res.pushed).toEqual(['w1'])
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

  it('【自動 pull なし】リモートのみ（ローカルに無い）は取得しない＝ローカル不変', async () => {
    const remoteWork = mkWork('w2', { title: 'Remote', updatedAt: 200 })
    const { deps, calls } = makeDeps([], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res).toEqual(EMPTY)
    expect(calls.pulled).toEqual([]) // 自動 pull しない（別端末の変更は明示リストアで取得）
    expect(calls.saved).toEqual([]) // ローカルを勝手に書かない
  })

  it('【上書き防止】クラウドの方が新しい → 古いローカルで上書きしない（push も pull もしない）', async () => {
    const local = mkWork('w3', { title: 'Local', updatedAt: 100 })
    const remoteWork = mkWork('w3', { title: 'Remote', updatedAt: 200 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res).toEqual(EMPTY)
    expect(calls.pushed).toEqual([]) // クラウドの新しいバックアップを守る
    expect(calls.saved).toEqual([]) // ローカルも書き換えない（ログアウト中の編集喪失を防ぐ）
  })

  it('ローカルが新しい → push（バックアップ）', async () => {
    const local = mkWork('w4', { title: 'Local', updatedAt: 300 })
    const remoteWork = mkWork('w4', { title: 'Remote', updatedAt: 100 })
    const { deps, calls } = makeDeps([local], [remoteOf(remoteWork)])
    const res = await runLoginSync(deps)

    expect(res.pushed).toEqual(['w4'])
    expect(calls.pulled).toEqual([])
  })

  it('内容一致 → 何もしない（noop）', async () => {
    const w5 = mkWork('w5', { updatedAt: 100 })
    const { deps, calls } = makeDeps([w5], [remoteOf(w5)])
    const res = await runLoginSync(deps)

    expect(res).toEqual(EMPTY)
    expect(calls.pushed).toEqual([])
  })

  it('ローカルのゴミ箱作品は同期対象外＝push もされない（ゴミ箱はローカルのみ）', async () => {
    // listLocalWorks は active のみを返す規約。ゴミ箱は含まれないので push されない。
    const active = mkWork('a1', { updatedAt: 100 })
    const { deps, calls } = makeDeps([active], [])
    await runLoginSync(deps)
    expect(calls.pushed).toEqual([{ workId: 'a1', parts: ['doc'] }])
    expect(calls.trashed).toEqual([]) // ゴミ箱の伝播はしない
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
