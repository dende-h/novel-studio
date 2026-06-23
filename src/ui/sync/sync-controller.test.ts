import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileRepository } from '@/core/profile'
import type { Work } from '@/core/schema'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { SyncMetaRepository } from '@/core/storage/syncMetaRepository'
import { WorkRepository } from '@/core/storage/workRepository'
import { createSyncController, type SyncPhase } from './sync-controller'

const DEBOUNCE = 30_000
const work = (id: string): Work => ({ id, title: 'T', episodes: [], updatedAt: 100 })

function harness() {
  const store = new MemoryStore()
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const syncMetaRepo = new SyncMetaRepository(store, 'user_1')
  const profileRepo = new ProfileRepository(store)

  const calls = {
    manifest: 0,
    pull: [] as string[],
    push: [] as Array<{ id: string; parts: Array<'doc' | 'media'> }>,
    del: [] as string[],
  }
  let pushStatus = 200
  let enabled = true
  let online = true
  const statuses: SyncPhase[] = []

  const controller = createSyncController({
    api: {
      async getManifest() {
        calls.manifest++
        return []
      },
      async pullWork(id) {
        calls.pull.push(id)
        return null
      },
      async pushWork(id, payload) {
        calls.push.push({ id, parts: payload.parts })
        if (pushStatus !== 200) return { status: pushStatus, result: null }
        return { status: 200, result: { docHash: 'sd', mediaHash: '', size: 1 } }
      },
      async deleteWork(id) {
        calls.del.push(id)
        return true
      },
    },
    repo,
    snapshotRepo,
    syncMetaRepo,
    profileRepo,
    hashPart: async (v) => JSON.stringify(v),
    genId: () => 'id',
    now: () => 1000,
    isEnabled: () => enabled,
    isOnline: () => online,
    debounceMs: DEBOUNCE,
    onStatus: (p) => statuses.push(p),
  })

  return {
    controller,
    repo,
    syncMetaRepo,
    calls,
    statuses,
    setPushStatus: (s: number) => {
      pushStatus = s
    },
    setEnabled: (v: boolean) => {
      enabled = v
    },
    setOnline: (v: boolean) => {
      online = v
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createSyncController — autosave push（coalesce）', () => {
  it('notifyChanged は debounce 後に 1 度だけ push する（複数回は合体）', async () => {
    const h = harness()
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    h.controller.notifyChanged('w1')
    expect(h.calls.push).toEqual([]) // まだ debounce 中
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.calls.push).toEqual([{ id: 'w1', parts: ['doc'] }])
  })

  it('flush で pending を即時 push し、syncing→idle を通知する', async () => {
    const h = harness()
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await h.controller.flush()
    expect(h.calls.push).toHaveLength(1)
    expect(h.statuses).toEqual(['syncing', 'idle'])
  })

  it('push 後に同期メタを記録する（次回の差分判定用）', async () => {
    const h = harness()
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await h.controller.flush()
    expect(await h.syncMetaRepo.get('w1')).toMatchObject({ workId: 'w1', docHash: 'sd' })
  })
})

describe('createSyncController — ゲスト/オフライン', () => {
  it('ゲスト（isEnabled=false）では何も push せず、runLoginSync は null', async () => {
    const h = harness()
    h.setEnabled(false)
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.calls.push).toEqual([])
    expect(await h.controller.runLoginSync()).toBeNull()
    expect(h.calls.manifest).toBe(0)
  })

  it('オフラインでは保留（push せず paused-offline）、復帰後の flush で送る', async () => {
    const h = harness()
    h.setOnline(false)
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await h.controller.flush()
    expect(h.calls.push).toEqual([])
    expect(h.statuses).toContain('paused-offline')

    h.setOnline(true)
    await h.controller.flush()
    expect(h.calls.push).toHaveLength(1)
  })
})

describe('createSyncController — エラーフェーズ', () => {
  it('push が 409 なら paused-superseded を通知', async () => {
    const h = harness()
    h.setPushStatus(409)
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await h.controller.flush()
    expect(h.statuses.at(-1)).toBe('paused-superseded')
  })

  it('push が 507 なら paused-capacity を通知', async () => {
    const h = harness()
    h.setPushStatus(507)
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1')
    await h.controller.flush()
    expect(h.statuses.at(-1)).toBe('paused-capacity')
  })
})

describe('createSyncController — runLoginSync / purge', () => {
  it('runLoginSync は manifest を読み、pending をクリアして二重 push を防ぐ', async () => {
    const h = harness()
    await h.repo.saveWork(work('w1'))
    h.controller.notifyChanged('w1') // pending＋タイマー
    const res = await h.controller.runLoginSync()
    expect(res).not.toBeNull()
    // Work 用（engineLoginSync）とプロフィール用（runProfileSync）で manifest を 2 回読む。
    expect(h.calls.manifest).toBe(2)
    const pushedDuringLogin = h.calls.push.length
    await vi.advanceTimersByTimeAsync(DEBOUNCE) // タイマーは解除済み → 追加 push なし
    expect(h.calls.push.length).toBe(pushedDuringLogin)
  })

  it('purge は deleteWork を呼び、同期メタを削除する', async () => {
    const h = harness()
    await h.syncMetaRepo.set({ workId: 'w1', docHash: 'd', mediaHash: '', syncedAt: 1 })
    await h.controller.purge('w1')
    expect(h.calls.del).toEqual(['w1'])
    expect(await h.syncMetaRepo.get('w1')).toBeNull()
  })

  it('purge はオフラインなら deleteWork を呼ばない（メタは消す）', async () => {
    const h = harness()
    h.setOnline(false)
    await h.syncMetaRepo.set({ workId: 'w1', docHash: 'd', mediaHash: '', syncedAt: 1 })
    await h.controller.purge('w1')
    expect(h.calls.del).toEqual([])
    expect(await h.syncMetaRepo.get('w1')).toBeNull()
  })
})
