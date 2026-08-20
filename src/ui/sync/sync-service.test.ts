// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { IdeaNote } from '@/core/idea'
import type { Plot } from '@/core/plot'
import { ProfileRepository } from '@/core/profile'
import type { Work } from '@/core/schema'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { ActivityRepository } from '@/core/storage/activityRepository'
import { IdeaRepository } from '@/core/storage/ideaRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { PlotRepository } from '@/core/storage/plotRepository'
import { StructureRepository } from '@/core/storage/structureRepository'
import { WorkRepository } from '@/core/storage/workRepository'
import type { Structure } from '@/core/structure'
import type { ActivityDay } from '@/core/sync/activityMerge'
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

const mkStructure = (id: string, workId: string, updatedAt: number, title = ''): Structure => ({
  id,
  workId,
  kind: 'outline',
  title,
  nodes: [],
  edges: [],
  updatedAt,
})

const mkIdea = (id: string, text: string, updatedAt: number): IdeaNote => ({
  id,
  text,
  createdAt: 1,
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
  // /api/sync/version 相当：サーバへの書き込みごとに進む世代。
  let version = 0
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
    version++
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
  // 構造・ネタ帳（プレフィックス付き id）用の汎用シード。json はテスト側で直列化して渡す。
  const seedItem = async (syncId: string, json: string, updatedAt: number) => {
    version++
    rows.set(syncId, {
      workId: syncId,
      updatedAt,
      trashedAt: 0,
      deleted: 0,
      docHash: await sha256Hex(json),
      json,
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
      version++
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
      version++
      rows.set(workId, { ...row, trashedAt: body.trashedAt, updatedAt: body.updatedAt })
      return { ok: true }
    },
    async deleteWork(workId, at) {
      const row = rows.get(workId)
      if (!row || row.deleted === 1) return true
      if (at < row.updatedAt) return false // 古い purge は 409（編集勝ち）＝クライアントには false
      version++
      rows.set(workId, { ...row, deleted: 1, json: '', updatedAt: at })
      return true
    },
  }
  return { rows, seed, seedItem, api, getVersion: () => version }
}

function makeEnv(
  remote = makeFakeRemote(),
  opts: {
    getOpenWork?: () => { id: string; dirty: boolean } | null
    /** 既定 null（オフライン相当）＝activity 同期はスキップされ、既存テストに影響しない。 */
    postActivity?: (days: ActivityDay[]) => Promise<ActivityDay[] | null>
    /** /api/sync/version の activity 世代（既定 0 固定）。送信スキップ解除の検証用。 */
    getActivityVersion?: () => number
  } = {},
) {
  const store = new MemoryStore()
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const structures = new StructureRepository(store)
  const ideas = new IdeaRepository(store)
  const profile = new ProfileRepository(store)
  const plots = new PlotRepository(store)
  const activityRepo = new ActivityRepository(store)
  const bases = new SyncBaseRepository(store)
  const lost = new Map<string, string>()
  let id = 0
  // remote.api は委譲で包む（テストが後から remote.api.* を差し替えられるように）。
  const service = createSyncService({
    repo,
    snapshotRepo,
    structures,
    ideas,
    profile,
    plots,
    bases,
    saveLost: async (syncId, json) => {
      lost.set(syncId, json)
    },
    postActivity: opts.postActivity ?? (async () => null),
    listActivity: () => activityRepo.list(),
    replaceActivity: (days) => activityRepo.replaceAll(days),
    manifest: () => remote.api.manifest(),
    getWork: (id) => remote.api.getWork(id),
    putWork: (id, body, o) => remote.api.putWork(id, body, o),
    patchWork: (id, body) => remote.api.patchWork(id, body),
    deleteWork: (id, at) => remote.api.deleteWork(id, at),
    getVersion: async () => ({
      works: remote.getVersion(),
      activity: opts.getActivityVersion?.() ?? 0,
    }),
    now: () => 1_000_000,
    genId: () => `snap-${++id}`,
    getOpenWork: opts.getOpenWork,
  })
  return {
    store,
    repo,
    snapshotRepo,
    structures,
    ideas,
    profile,
    plots,
    activityRepo,
    bases,
    lost,
    remote,
    service,
  }
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

  it('開いている作品への pull は「下書きが未保存（dirty）」の間だけ見送る', async () => {
    const remote = makeFakeRemote()
    let dirty = true
    const { repo, service } = makeEnv(remote, { getOpenWork: () => ({ id: 'w1', dirty }) })
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile()
    await remote.seed(mkWork('w1', 'リモート編集', 300))

    const during = await service.reconcile() // 入力中（未保存）は上書きしない
    expect(during?.pulled).toBe(0)
    expect((await repo.getWork('w1'))?.title).toBe('v1')

    dirty = false // 自動保存が確定した（開いたままで良い）
    const after = await service.reconcile()
    expect(after?.pulled).toBe(1)
    expect((await repo.getWork('w1'))?.title).toBe('リモート編集') // 図鑑・本文が開いたまま届く
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

describe('構造・ネタ帳の同期（D-SYNC2-ITEMS・プレフィックス付き id）', () => {
  it('ローカルの構造・ネタ帳を push し、プレフィックス付き id でリモートに載る', async () => {
    const { structures, ideas, bases, remote, service } = makeEnv()
    await structures.put(mkStructure('s1', 'w1', 100, 'プロット'))
    await ideas.put(mkIdea('n1', '雨の日の出会い', 100))
    const summary = await service.reconcile()
    expect(summary?.pushed).toBe(2)
    expect(remote.rows.get('structure:s1')?.json).toContain('プロット')
    expect(remote.rows.get('idea:n1')?.json).toContain('雨の日の出会い')
    expect(await bases.get('structure:s1')).toBeDefined()
    expect(await bases.get('idea:n1')).toBeDefined()
  })

  it('他端末の構造を pull し、updatedAt を刻印せずそのまま保存する', async () => {
    const remote = makeFakeRemote()
    const incoming = mkStructure('s2', 'w9', 777, '相関図メモ')
    await remote.seedItem('structure:s2', JSON.stringify(incoming), 777)
    const { structures, service } = makeEnv(remote)
    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    const got = await structures.get('s2')
    expect(got?.title).toBe('相関図メモ')
    expect(got?.updatedAt).toBe(777) // put（素通し）＝時計が進まない
  })

  it('構造の競合はリモートが新しければ synclost へ退避してから採用する', async () => {
    const { structures, lost, remote, service } = makeEnv()
    await structures.put(mkStructure('s1', 'w1', 100, 'v1'))
    await service.reconcile()
    await structures.put(mkStructure('s1', 'w1', 150, 'ローカル編集'))
    await remote.seedItem(
      'structure:s1',
      JSON.stringify(mkStructure('s1', 'w1', 300, 'リモート編集')),
      300,
    )
    const summary = await service.reconcile()
    expect(summary?.conflicts).toEqual([{ workId: 'structure:s1', winner: 'remote' }])
    expect((await structures.get('s1'))?.title).toBe('リモート編集')
    expect(lost.get('structure:s1')).toContain('ローカル編集')
  })

  it('リモートのトゥームストーンで構造・ネタ帳を削除する（synclost へ退避してから）', async () => {
    const { structures, ideas, lost, remote, service } = makeEnv()
    await structures.put(mkStructure('s1', 'w1', 100, '消える構造'))
    await ideas.put(mkIdea('n1', '消えるネタ', 100))
    await service.reconcile()
    for (const id of ['structure:s1', 'idea:n1']) {
      const row = remote.rows.get(id)
      if (!row) throw new Error('seed 失敗')
      remote.rows.set(id, { ...row, deleted: 1, json: '', updatedAt: 900 })
    }
    await service.reconcile()
    expect(await structures.get('s1')).toBeUndefined()
    expect(await ideas.get('n1')).toBeUndefined()
    expect(lost.get('structure:s1')).toContain('消える構造')
    expect(lost.get('idea:n1')).toContain('消えるネタ')
  })

  it('開いている作品に紐づく構造でも pull は適用する（構造ビューは自前 state 表示で衝突しない）', async () => {
    const remote = makeFakeRemote()
    const { structures, service } = makeEnv(remote, {
      getOpenWork: () => ({ id: 'w1', dirty: true }),
    })
    await structures.put(mkStructure('s1', 'w1', 100, 'v1'))
    await service.reconcile()
    await remote.seedItem(
      'structure:s1',
      JSON.stringify(mkStructure('s1', 'w1', 300, 'リモート編集')),
      300,
    )
    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    expect((await structures.get('s1'))?.title).toBe('リモート編集')
  })

  it('ローカルで削除した構造は purge がリモートへ伝播する', async () => {
    const { structures, remote, service } = makeEnv()
    await structures.put(mkStructure('s1', 'w1', 100))
    await service.reconcile()
    await structures.remove('s1')
    await service.reconcile()
    expect(remote.rows.get('structure:s1')?.deleted).toBe(1)
  })
})

const mkPlot = (id: string, workId: string, updatedAt: number, title = '本編プロット'): Plot => ({
  id,
  workId,
  title,
  sections: [],
  beats: [],
  lines: [],
  foreshadows: [],
  secrets: [],
  updatedAt,
})

describe('プロットの同期（plot:<id>・D-SYNC2-ITEMS の第4種目）', () => {
  it('ローカルのプロットを push し、プレフィックス付き id でリモートに載る', async () => {
    const { plots, bases, remote, service } = makeEnv()
    await plots.put(mkPlot('p1', 'w1', 100))
    const summary = await service.reconcile()
    expect(summary?.pushed).toBe(1)
    expect(remote.rows.get('plot:p1')?.json).toContain('本編プロット')
    expect(await bases.get('plot:p1')).toBeDefined()
  })

  it('他端末のプロットを pull し、updatedAt を刻印せずそのまま保存する', async () => {
    const remote = makeFakeRemote()
    await remote.seedItem('plot:p2', JSON.stringify(mkPlot('p2', 'w9', 777, '改稿第2案')), 777)
    const { plots, service } = makeEnv(remote)
    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    const got = await plots.get('p2')
    expect(got?.title).toBe('改稿第2案')
    expect(got?.updatedAt).toBe(777) // put（素通し）＝時計が進まない
  })

  it('競合はリモートが新しければ synclost へ退避してから採用する', async () => {
    const { plots, lost, remote, service } = makeEnv()
    await plots.put(mkPlot('p1', 'w1', 100, 'v1'))
    await service.reconcile()
    await plots.put(mkPlot('p1', 'w1', 150, 'ローカル編集'))
    await remote.seedItem('plot:p1', JSON.stringify(mkPlot('p1', 'w1', 300, 'リモート編集')), 300)
    const summary = await service.reconcile()
    expect(summary?.conflicts).toEqual([{ workId: 'plot:p1', winner: 'remote' }])
    expect((await plots.get('p1'))?.title).toBe('リモート編集')
    expect(lost.get('plot:p1')).toContain('ローカル編集')
  })

  it('削除は両方向へ伝播する（リモート tombstone→synclost 退避つき削除／ローカル削除→purge）', async () => {
    const { plots, lost, remote, service } = makeEnv()
    await plots.put(mkPlot('p1', 'w1', 100, '消えるプロット'))
    await plots.put(mkPlot('p2', 'w1', 100))
    await service.reconcile()
    const row = remote.rows.get('plot:p1')
    if (!row) throw new Error('seed 失敗')
    remote.rows.set('plot:p1', { ...row, deleted: 1, json: '', updatedAt: 900 })
    await plots.remove('p2')
    await service.reconcile()
    expect(await plots.get('p1')).toBeUndefined()
    expect(lost.get('plot:p1')).toContain('消えるプロット')
    expect(remote.rows.get('plot:p2')?.deleted).toBe(1)
  })
})

describe('プロフィールの同期（profile:me・LWW）', () => {
  it('設定済みプロフィール（updatedAt あり）を push し base を記録する', async () => {
    const { profile, bases, remote, service } = makeEnv()
    await profile.save({ penName: '筆名A', updatedAt: 100 })
    const summary = await service.reconcile()
    expect(summary?.pushed).toBe(1)
    expect(remote.rows.get('profile:me')?.json).toContain('筆名A')
    expect(await bases.get('profile:me')).toBeDefined()
  })

  it('未設定（updatedAt なし）のプロフィールは push しない', async () => {
    const { profile, remote, service } = makeEnv()
    // 旧バージョンで保存された updatedAt 無しレコードも「未設定」と同じ扱い（次の編集で載る）
    await profile.save({ penName: '旧形式' })
    await service.reconcile()
    expect(remote.rows.has('profile:me')).toBe(false)
  })

  it('新しい端末はリモートのプロフィールを pull して取り込む', async () => {
    const remote = makeFakeRemote()
    await remote.seedItem(
      'profile:me',
      JSON.stringify({ penName: '別端末の筆名', updatedAt: 777 }),
      777,
    )
    const { profile, service } = makeEnv(remote)
    const summary = await service.reconcile()
    expect(summary?.pulled).toBe(1)
    const got = await profile.get()
    expect(got.penName).toBe('別端末の筆名')
    expect(got.updatedAt).toBe(777) // 素通し保存＝時計が進まない
  })

  it('競合はリモートが新しければ synclost へ退避してから採用する（LWW）', async () => {
    const { profile, lost, remote, service } = makeEnv()
    await profile.save({ penName: 'v1', updatedAt: 100 })
    await service.reconcile()
    await profile.save({ penName: 'ローカル編集', updatedAt: 150 })
    await remote.seedItem(
      'profile:me',
      JSON.stringify({ penName: 'リモート編集', updatedAt: 300 }),
      300,
    )
    const summary = await service.reconcile()
    expect(summary?.conflicts).toEqual([{ workId: 'profile:me', winner: 'remote' }])
    expect((await profile.get()).penName).toBe('リモート編集')
    expect(lost.get('profile:me')).toContain('ローカル編集')
  })

  it('リモートのトゥームストーンでもローカルのプロフィールは消さない（防御）', async () => {
    const { profile, remote, service } = makeEnv()
    await profile.save({ penName: '守られる', updatedAt: 100 })
    await service.reconcile()
    const row = remote.rows.get('profile:me')
    if (!row) throw new Error('push 失敗')
    remote.rows.set('profile:me', { ...row, deleted: 1, json: '', updatedAt: 900 })
    await service.reconcile()
    expect((await profile.get()).penName).toBe('守られる')
  })
})

describe('執筆の記録の同期（D-SYNC2-ACTIVITY-DB・max マージ）', () => {
  const day = (date: string, added: number, saves = 1): ActivityDay => ({
    date,
    added,
    removed: 0,
    saves,
    updatedAt: 100,
  })

  it('サーバ応答を日付ごと max マージしてローカルへ反映する（net は再計算）', async () => {
    const sent: ActivityDay[][] = []
    const { activityRepo, service } = makeEnv(makeFakeRemote(), {
      postActivity: async (days) => {
        sent.push(days)
        // サーバには別端末の分（8/01 が大きい・8/02 は新規）が入っている体
        return [day('2026-08-01', 500, 5), day('2026-08-02', 300, 2)]
      },
    })
    await activityRepo.record(200, Date.parse('2026-08-01T12:00:00Z'))
    await service.reconcile()
    const merged = await activityRepo.list()
    expect(sent[0]?.length).toBe(1) // ローカル全日分を送っている
    const d1 = merged.find((d) => d.date === '2026-08-01')
    const d2 = merged.find((d) => d.date === '2026-08-02')
    expect(d1?.added).toBe(500) // max 側が残る
    expect(d1?.net).toBe(500) // net は added - removed から導出
    expect(d2?.added).toBe(300) // 別端末の日が取り込まれる
  })

  it('サーバ応答が小さくてもローカルの値は巻き戻らない（往復中の増分も守る）', async () => {
    const { activityRepo, service } = makeEnv(makeFakeRemote(), {
      postActivity: async () => [day('2026-08-01', 10)],
    })
    await activityRepo.record(999, Date.parse('2026-08-01T12:00:00Z'))
    await service.reconcile()
    const d = (await activityRepo.list()).find((x) => x.date === '2026-08-01')
    expect(d?.added).toBe(999)
  })

  it('postActivity が失敗（オフライン）してもローカルは無傷で reconcile は成功する', async () => {
    const { activityRepo, service } = makeEnv() // 既定 postActivity = null
    await activityRepo.record(100, Date.parse('2026-08-01T12:00:00Z'))
    const summary = await service.reconcile()
    expect(summary).not.toBeNull()
    expect((await activityRepo.list()).length).toBe(1)
  })

  it('ローカル不変かつリモート世代も不動なら送信をスキップする（レート制限の節約）', async () => {
    let posts = 0
    const { activityRepo, service } = makeEnv(makeFakeRemote(), {
      postActivity: async (days) => {
        posts++
        return days // サーバに新情報なし（エコー）
      },
    })
    await activityRepo.record(100, Date.parse('2026-08-01T12:00:00Z'))
    await service.reconcile()
    expect(posts).toBe(1)
    await service.reconcile() // 何も変わっていない 2 回目
    expect(posts).toBe(1) // スキップされる
    await activityRepo.record(50, Date.parse('2026-08-01T13:00:00Z')) // ローカルが進んだ
    await service.reconcile()
    expect(posts).toBe(2)
  })

  it('送信失敗（オフライン）の回はスキップ印を残さず、次の reconcile で再送する', async () => {
    let posts = 0
    let online = false
    const { activityRepo, service } = makeEnv(makeFakeRemote(), {
      postActivity: async (days) => {
        posts++
        return online ? days : null
      },
    })
    await activityRepo.record(100, Date.parse('2026-08-01T12:00:00Z'))
    await service.reconcile() // 失敗（null）
    expect(posts).toBe(1)
    online = true
    await service.reconcile() // ローカル不変でも成功していないので再送される
    expect(posts).toBe(2)
  })

  it('poll がリモートの activity 世代の前進を見たら、ローカル不変でも次の同期で送受信する', async () => {
    let posts = 0
    let activityVersion = 1
    const { activityRepo, service } = makeEnv(makeFakeRemote(), {
      postActivity: async (days) => {
        posts++
        return days
      },
      getActivityVersion: () => activityVersion,
    })
    await activityRepo.record(100, Date.parse('2026-08-01T12:00:00Z'))
    await service.poll() // 初回＝本同期（送信 1 回目）・世代を記録
    expect(posts).toBe(1)
    await service.poll() // 世代不動 → no-op
    expect(posts).toBe(1)
    activityVersion = 2 // 別端末が執筆の記録を進めた
    await service.poll()
    expect(posts).toBe(2) // ローカル不変でも取り込みのため送受信する
  })
})

describe('poll の世代記録は成功時のみ', () => {
  it('reconcile が失敗（オフライン）した回の世代は記録せず、回復後の poll で取り込める', async () => {
    const remote = makeFakeRemote()
    await remote.seed(mkWork('w1', '別端末の作品', 200)) // 世代が進んだ状態
    const { repo, service } = makeEnv(remote)

    // manifest だけ落ちている（オフライン相当）→ reconcile は null
    const origManifest = remote.api.manifest
    remote.api.manifest = async () => null
    expect(await service.poll()).toBeNull()

    // 回復後の poll：先ほどの世代を「見た」ことにしていなければ本同期が走り pull される
    remote.api.manifest = origManifest
    const after = await service.poll()
    expect(after?.pulled).toBe(1)
    expect((await repo.getWork('w1'))?.title).toBe('別端末の作品')
  })
})

describe('壊れたローカルレコードの隔離（masked）', () => {
  it('直列化できないレコードが 1 件あっても他の同期は続行し、誤 purge もしない', async () => {
    const { store, repo, remote, bases, service } = makeEnv()
    await repo.saveWork(mkWork('w1', '正常な作品', 100))
    // スキーマを満たさない壊れたネタ帳レコード（旧バージョンの残骸などを想定）
    await store.set('idea:broken', { garbage: true })
    // 壊れた id に base とリモート行が残っている状況（＝欠落と誤認すると purgeRemote が走る）
    await bases.set({ workId: 'idea:broken', baseHash: 'h-old', remoteUpdatedAt: 1, syncedAt: 1 })
    await remote.seedItem('idea:broken', '{"whatever":1}', 50)

    const summary = await service.reconcile()
    expect(summary?.pushed).toBe(1) // 正常な作品は同期される
    expect(remote.rows.get('w1')).toBeDefined()
    expect(remote.rows.get('idea:broken')?.deleted).toBe(0) // 誤ってトゥームストーン化されない
    expect(await bases.get('idea:broken')).toBeDefined() // base も温存
  })
})

describe('poll（世代チェック付きの軽量同期）', () => {
  it('世代が動いていなければ本同期を省略し、動いたときだけ reconcile する', async () => {
    const remote = makeFakeRemote()
    const { repo, service } = makeEnv(remote)
    await repo.saveWork(mkWork('w1', 'v1', 100))
    await service.reconcile() // 初回同期（push で世代が進む）

    // 自分の push 分は poll 内で世代を取り直して記録するため、直後の poll は no-op
    const idle = await service.poll()
    expect(idle).toEqual({ pushed: 0, pulled: 0, conflicts: [], changedLocal: false })

    // 別端末の書き込みで世代が進む → poll が本同期を走らせ pull される
    await remote.seed(mkWork('w2', '別端末の新作', 200))
    const active = await service.poll()
    expect(active?.pulled).toBe(1)
    expect((await repo.getWork('w2'))?.title).toBe('別端末の新作')
  })
})
