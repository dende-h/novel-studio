// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Work } from '@/core/schema'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { WorkRepository } from '@/core/storage/workRepository'
import { canonicalWorkJson, sha256Hex } from '@/core/sync/hash'
import { SyncBaseRepository } from '@/core/sync/syncBaseRepository'
import type { RemoteWorkMeta } from '@/core/sync/types'
import { createSyncService, type SyncDeps } from './sync-service'

/**
 * reconcile ループの結合テスト。サーバは仕様（CAS・LWW・トゥームストーン）どおりの
 * in-memory フェイクで再現し、「1 端末のローカル状態＋フェイクサーバ」で往復を検証する。
 */

const mkWork = (id: string, title: string, updatedAt: number): Work => ({
  id,
  title,
  episodes: [],
  updatedAt,
})

interface RemoteRow {
  workId: string
  updatedAt: number
  trashedAt: number
  deleted: 0 | 1
  docHash: string
  json: string
}

/** 仕様 §A の CAS/LWW を備えた in-memory サーバ。onManifest で「同期中の他端末の書き込み」を差し込める。 */
function makeFakeRemote(hooks: { onManifest?: () => void | Promise<void> } = {}) {
  const rows = new Map<string, RemoteRow>()
  const metaOf = (r: RemoteRow): RemoteWorkMeta => ({
    workId: r.workId,
    updatedAt: r.updatedAt,
    trashedAt: r.trashedAt,
    deleted: r.deleted,
    docHash: r.docHash,
    docSize: r.json.length,
    syncedAt: 0,
  })
  const seed = async (work: Work, over: Partial<RemoteRow> = {}) => {
    const json = canonicalWorkJson(work)
    rows.set(work.id, {
      workId: work.id,
      updatedAt: work.updatedAt ?? 0,
      trashedAt: 0,
      deleted: 0,
      docHash: await sha256Hex(json),
      json,
      ...over,
    })
  }
  const api: Pick<SyncDeps, 'manifest' | 'getWork' | 'putWork' | 'patchWork' | 'deleteWork'> = {
    async manifest() {
      // hook は「manifest を返した後に他端末が書き込んだ」を再現するため、返却内容を確定させてから呼ぶ。
      const result = [...rows.values()].map(metaOf)
      await hooks.onManifest?.()
      return result
    },
    async getWork(workId) {
      const r = rows.get(workId)
      if (!r || r.deleted === 1) return null
      return { json: r.json, updatedAt: r.updatedAt, trashedAt: r.trashedAt, docHash: r.docHash }
    },
    async putWork(workId, plaintext, opts) {
      const row = rows.get(workId)
      if (!row) {
        if (opts.baseHash !== '') {
          const empty: RemoteRow = {
            workId,
            updatedAt: 0,
            trashedAt: 0,
            deleted: 0,
            docHash: '',
            json: '',
          }
          return { ok: false, conflict: metaOf(empty) }
        }
      } else if (row.deleted === 1) {
        if (!(opts.updatedAt > row.updatedAt)) return { ok: false, conflict: metaOf(row) }
      } else if (opts.baseHash !== row.docHash) {
        return { ok: false, conflict: metaOf(row) }
      }
      const docHash = await sha256Hex(plaintext)
      rows.set(workId, {
        workId,
        updatedAt: opts.updatedAt,
        trashedAt: opts.trashedAt,
        deleted: 0,
        docHash,
        json: plaintext,
      })
      return { ok: true, docHash, syncedAt: 0 }
    },
    async patchWork(workId, body) {
      const row = rows.get(workId)
      if (!row || row.deleted === 1) return null
      if (body.updatedAt < row.updatedAt) return { ok: false, conflict: metaOf(row) }
      rows.set(workId, { ...row, trashedAt: body.trashedAt, updatedAt: body.updatedAt })
      return { ok: true }
    },
    async deleteWork(workId, at) {
      const row = rows.get(workId)
      if (!row || row.deleted === 1) return true
      if (at < row.updatedAt) return false // 古い purge は 409（編集勝ち）＝クライアントには false
      rows.set(workId, { ...row, deleted: 1, json: '', updatedAt: at })
      return true
    },
  }
  return { rows, seed, api }
}

function makeEnv(remote = makeFakeRemote(), opts: { getOpenWorkId?: () => string | null } = {}) {
  const store = new MemoryStore()
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const bases = new SyncBaseRepository(store)
  let id = 0
  // remote.api は委譲で包む（テストが後から remote.api.* を差し替えられるように）。
  const service = createSyncService({
    repo,
    snapshotRepo,
    bases,
    manifest: () => remote.api.manifest(),
    getWork: (id) => remote.api.getWork(id),
    putWork: (id, body, o) => remote.api.putWork(id, body, o),
    patchWork: (id, body) => remote.api.patchWork(id, body),
    deleteWork: (id, at) => remote.api.deleteWork(id, at),
    now: () => 1_000_000,
    genId: () => `snap-${++id}`,
    getOpenWorkId: opts.getOpenWorkId,
  })
  return { store, repo, snapshotRepo, bases, remote, service }
}

describe('sync-service reconcile', () => {
  it('新規ローカル作品を push し base を記録する', async () => {
    const { repo, bases, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '新作', 100))
    const summary = await service.reconcile()
    expect(summary?.pushed).toBe(1)
    expect(remote.rows.get('w1')?.deleted).toBe(0)
    expect((await bases.get('w1'))?.baseHash).toBe(remote.rows.get('w1')?.docHash)
  })

  it('他端末の新規作品を pull してローカルへ反映する', async () => {
    const remote = makeFakeRemote()
    await remote.seed(mkWork('w2', '別端末の作品', 200))
    const { repo, service } = makeEnv(remote)
    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    expect(summary?.changedLocal).toBe(true)
    expect((await repo.getWork('w2'))?.title).toBe('別端末の作品')
  })

  it('双方 clean なら何もしない（2 回目の reconcile が no-op）', async () => {
    const { repo, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '安定', 100))
    await service.reconcile()
    const second = await service.reconcile()
    expect(second).toEqual({ pushed: 0, pulled: 0, conflicts: [], changedLocal: false })
  })

  it('競合（双方編集）はリモートが新しければ snapshot 退避してから pull する', async () => {
    const { repo, snapshotRepo, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile() // base 確立
    await repo.saveWork(mkWork('w1', 'ローカル編集', 150))
    await remote.seed(mkWork('w1', 'リモート編集', 300)) // 別端末が先に push した体
    const summary = await service.reconcile()
    expect(summary?.conflicts).toEqual([{ workId: 'w1', winner: 'remote' }])
    expect((await repo.getWork('w1'))?.title).toBe('リモート編集')
    // 敗者（ローカル編集版）が履歴に退避されている
    const snaps = await snapshotRepo.list('w1')
    expect(snaps.some((s) => s.work.title === 'ローカル編集')).toBe(true)
  })

  it('競合はローカルが新しければ CAS を踏み直して push で勝つ', async () => {
    const { repo, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile()
    await remote.seed(mkWork('w1', 'リモート編集', 200))
    await repo.saveWork(mkWork('w1', 'ローカル編集（新しい）', 300))
    const summary = await service.reconcile()
    expect(summary?.conflicts).toEqual([{ workId: 'w1', winner: 'local' }])
    expect(remote.rows.get('w1')?.json).toContain('ローカル編集（新しい）')
  })

  it('リモートのゴミ箱状態をローカルへ伝播する（共有ゴミ箱・復活しない）', async () => {
    const { repo, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '捨てられる', 100))
    await service.reconcile()
    // 別端末がゴミ箱へ（updated_at が前進）
    const row = remote.rows.get('w1')
    if (!row) throw new Error('seed 失敗')
    remote.rows.set('w1', { ...row, trashedAt: 500, updatedAt: 500 })
    const summary = await service.reconcile()
    expect(summary?.changedLocal).toBe(true)
    expect(await repo.getWork('w1')).toBeUndefined()
    expect((await repo.listTrash()).map((t) => t.id)).toEqual(['w1'])
  })

  it('ローカルの purge（base 残留・実体なし）をリモートへ伝播しトゥームストーン化する', async () => {
    const { repo, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '完全削除される', 100))
    await service.reconcile()
    await repo.deleteWork('w1') // ゴミ箱を経ず消えた体（purge 済み）
    await service.reconcile()
    expect(remote.rows.get('w1')?.deleted).toBe(1)
  })

  it('リモートのトゥームストーンでローカルを purge する（snapshot へ退避してから）', async () => {
    const { repo, snapshotRepo, remote, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '別端末で完全削除', 100))
    await service.reconcile()
    const row = remote.rows.get('w1')
    if (!row) throw new Error('seed 失敗')
    remote.rows.set('w1', { ...row, deleted: 1, json: '', updatedAt: 900 })
    await service.reconcile()
    expect(await repo.getWork('w1')).toBeUndefined()
    expect((await snapshotRepo.list('w1')).length).toBeGreaterThan(0)
  })

  it('purge の伝播に失敗したら base を温存し、消した作品を pull で復活させない', async () => {
    const remote = makeFakeRemote()
    const { repo, bases, service } = makeEnv(remote)
    await repo.saveWork(mkWork('w1', '消される', 100))
    await service.reconcile()
    await repo.deleteWork('w1') // ローカルで purge 済み

    // DELETE がオフライン等で失敗する状況。base を消してしまうと次の reconcile が
    // 「他端末の新規」と誤認して pull し、消した作品が復活する（旧設計の失敗）。
    const origDelete = remote.api.deleteWork
    remote.api.deleteWork = async () => false
    await service.reconcile()
    expect(await bases.get('w1')).toBeDefined() // base 温存
    expect(await repo.getWork('w1')).toBeUndefined() // 復活していない
    expect(remote.rows.get('w1')?.deleted).toBe(0) // まだ伝播できていない

    // 回復後の reconcile で purge が伝播し、base も掃除される
    remote.api.deleteWork = origDelete
    await service.reconcile()
    expect(remote.rows.get('w1')?.deleted).toBe(1)
    expect(await bases.get('w1')).toBeUndefined()
  })

  it('purge 後にリモートが前進していたら purge せず取り戻す（削除 vs 編集は編集勝ち）', async () => {
    const remote = makeFakeRemote()
    const { repo, service } = makeEnv(remote)
    await repo.saveWork(mkWork('w1', '消される', 100))
    await service.reconcile()
    await repo.deleteWork('w1') // ローカルで purge 済み
    await remote.seed(mkWork('w1', '別端末が編集継続', 2_000_000)) // その後の編集

    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    expect((await repo.getWork('w1'))?.title).toBe('別端末が編集継続')
    expect(remote.rows.get('w1')?.deleted).toBe(0)
  })

  it('執筆画面で開いている作品への pull は見送る（画面を離れた後の reconcile で反映）', async () => {
    const remote = makeFakeRemote()
    let openId: string | null = 'w1'
    const { repo, service } = makeEnv(remote, { getOpenWorkId: () => openId })
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile()
    await remote.seed(mkWork('w1', 'リモート編集', 300))

    const during = await service.reconcile() // 開いている間は上書きしない
    expect(during?.pulled).toBe(0)
    expect((await repo.getWork('w1'))?.title).toBe('v1')

    openId = null // エディタを離れた
    const after = await service.reconcile()
    expect(after?.pulled).toBe(1)
    expect((await repo.getWork('w1'))?.title).toBe('リモート編集')
  })

  it('pull のネットワーク往復中にローカルが編集されたら上書きせず、再計画で競合として扱う', async () => {
    const remote = makeFakeRemote()
    const { repo, snapshotRepo, service } = makeEnv(remote)
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile()
    await remote.seed(mkWork('w1', 'リモート編集', 2_000_000))

    // getWork（pull のダウンロード）中にユーザーが編集した状況を再現する
    const origGet = remote.api.getWork
    let raced = false
    remote.api.getWork = async (id) => {
      if (!raced) {
        raced = true
        await repo.saveWork(mkWork('w1', '往復中の編集', 1_500_000))
      }
      return origGet(id)
    }

    const summary = await service.reconcile()
    // 往復中の編集は黙って消えず、再計画の三方向差分で競合（リモート勝ち）として退避される
    expect(summary?.conflicts).toEqual([{ workId: 'w1', winner: 'remote' }])
    expect((await repo.getWork('w1'))?.title).toBe('リモート編集')
    const snaps = await snapshotRepo.list('w1')
    expect(snaps.some((s) => s.work.title === '往復中の編集')).toBe(true)
  })

  it('subscribeSummary は追走を含む全実行の結果を届ける', async () => {
    const remote = makeFakeRemote()
    await remote.seed(mkWork('w2', '別端末の作品', 200))
    const { service } = makeEnv(remote)
    const seen: number[] = []
    service.subscribeSummary((s) => seen.push(s.pulled))
    await service.reconcile()
    expect(seen).toEqual([1])
  })

  it('CAS 409（同期中に他端末が push）は manifest を取り直して 1 回で解決する', async () => {
    let raced = false
    const remote = makeFakeRemote({
      onManifest: async () => {
        // manifest 返却直後に別端末の編集が入る＝この端末の push は CAS 不一致で 409 になる
        if (raced) return
        const row = remote.rows.get('w1')
        if (row) {
          raced = true
          await remote.seed(mkWork('w1', '他端末が先に編集', 500))
        }
      },
    })
    const { repo, service } = makeEnv(remote)
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile()
    await repo.saveWork(mkWork('w1', 'この端末の編集', 200))
    const summary = await service.reconcile()
    // 409 → 再 reconcile → 三方向差分で競合として解決（リモートの方が新しいので remote 勝ち）
    expect(summary?.conflicts.map((c) => c.winner)).toContain('remote')
    expect((await repo.getWork('w1'))?.title).toBe('他端末が先に編集')
  })
})
