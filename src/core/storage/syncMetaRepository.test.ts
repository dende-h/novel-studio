import { describe, expect, it } from 'vitest'
import type { LocalSyncMeta } from '../sync/manifest'
import { MemoryStore } from './memoryStore'
import { SyncMetaRepository } from './syncMetaRepository'

const meta = (workId: string, docHash = 'd', mediaHash = 'm'): LocalSyncMeta => ({
  workId,
  docHash,
  mediaHash,
  syncedAt: 1000,
})

describe('SyncMetaRepository（対 MemoryStore）', () => {
  it('set → get で同一の同期メタを復元', async () => {
    const repo = new SyncMetaRepository(new MemoryStore(), 'user_1')
    const m = meta('w1')
    await repo.set(m)
    expect(await repo.get('w1')).toEqual(m)
  })

  it('get(未保存 id) は null', async () => {
    const repo = new SyncMetaRepository(new MemoryStore(), 'user_1')
    expect(await repo.get('nope')).toBeNull()
  })

  it('set は同一 workId を上書き（後勝ち）', async () => {
    const repo = new SyncMetaRepository(new MemoryStore(), 'user_1')
    await repo.set(meta('w1', 'd1'))
    await repo.set(meta('w1', 'd2'))
    expect((await repo.get('w1'))?.docHash).toBe('d2')
  })

  it('delete で対象だけ消える', async () => {
    const repo = new SyncMetaRepository(new MemoryStore(), 'user_1')
    await repo.set(meta('w1'))
    await repo.set(meta('w2'))
    await repo.delete('w1')
    expect(await repo.get('w1')).toBeNull()
    expect(await repo.get('w2')).not.toBeNull()
  })

  it('ユーザー単位で分離（別 userId からは見えない）', async () => {
    const store = new MemoryStore()
    const a = new SyncMetaRepository(store, 'user_1')
    const b = new SyncMetaRepository(store, 'user_2')
    await a.set(meta('w1', 'aaa'))
    await b.set(meta('w1', 'bbb'))
    expect((await a.get('w1'))?.docHash).toBe('aaa')
    expect((await b.get('w1'))?.docHash).toBe('bbb')
  })

  it('clearAll は自分のメタだけ全消し、他ユーザーは残す', async () => {
    const store = new MemoryStore()
    const a = new SyncMetaRepository(store, 'user_1')
    const b = new SyncMetaRepository(store, 'user_2')
    await a.set(meta('w1'))
    await a.set(meta('w2'))
    await b.set(meta('w1'))
    await a.clearAll()
    expect(await a.get('w1')).toBeNull()
    expect(await a.get('w2')).toBeNull()
    expect(await b.get('w1')).not.toBeNull()
  })
})
