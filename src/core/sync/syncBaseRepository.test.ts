// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../storage/memoryStore'
import { SyncBaseRepository } from './syncBaseRepository'
import type { SyncBase } from './types'

const base = (workId: string, over: Partial<SyncBase> = {}): SyncBase => ({
  workId,
  baseHash: `hash-${workId}`,
  remoteUpdatedAt: 100,
  syncedAt: 200,
  ...over,
})

describe('SyncBaseRepository（対 MemoryStore）', () => {
  it('set → get で取得できる', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    await r.set(base('w1'))
    expect(await r.get('w1')).toEqual(base('w1'))
  })

  it('未保存の get は undefined', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    expect(await r.get('nope')).toBeUndefined()
  })

  it('同じ workId への set は上書き', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    await r.set(base('w1', { baseHash: 'old' }))
    await r.set(base('w1', { baseHash: 'new', remoteUpdatedAt: 300 }))
    expect(await r.get('w1')).toEqual(base('w1', { baseHash: 'new', remoteUpdatedAt: 300 }))
  })

  it('list は全 base を返す', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    await r.set(base('w1'))
    await r.set(base('w2'))
    const list = await r.list()
    expect(list.map((b) => b.workId).sort()).toEqual(['w1', 'w2'])
  })

  it('delete で 1 件だけ消える', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    await r.set(base('w1'))
    await r.set(base('w2'))
    await r.delete('w1')
    expect(await r.get('w1')).toBeUndefined()
    expect(await r.get('w2')).toEqual(base('w2'))
  })

  it('clearAll で全 base が消える（復元後の再同期用）', async () => {
    const r = new SyncBaseRepository(new MemoryStore())
    await r.set(base('w1'))
    await r.set(base('w2'))
    await r.clearAll()
    expect(await r.list()).toEqual([])
  })

  it('clearAll は他の名前空間（work: 等）に触らない', async () => {
    const store = new MemoryStore()
    await store.set('work:w1', { id: 'w1' })
    await store.set('snap:w1', [])
    const r = new SyncBaseRepository(store)
    await r.set(base('w1'))
    await r.clearAll()
    expect(await store.get('work:w1')).toEqual({ id: 'w1' })
    expect(await store.get('snap:w1')).toEqual([])
  })
})
