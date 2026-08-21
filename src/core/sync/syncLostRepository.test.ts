import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../storage/memoryStore'
import { type SyncLostEntry, SyncLostRepository } from './syncLostRepository'

const entry = (syncId: string, at: number, over: Partial<SyncLostEntry> = {}): SyncLostEntry => ({
  syncId,
  at,
  kind: 'structure',
  reason: 'conflict',
  json: '{"id":"x"}',
  ...over,
})

describe('SyncLostRepository（退避の置き場所）', () => {
  it('保存した退避を新しい順に返す', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save(entry('structure:a', 100))
    await repo.save(entry('idea:b', 300, { kind: 'idea' }))
    await repo.save(entry('plot:c', 200, { kind: 'plot' }))
    expect((await repo.list()).map((e) => e.syncId)).toEqual(['idea:b', 'plot:c', 'structure:a'])
  })

  it('同じアイテムは 1 世代（上書き）＝件数が増え続けない', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save(entry('structure:a', 100, { json: '古い' }))
    await repo.save(entry('structure:a', 200, { json: '新しい' }))
    const list = await repo.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.json).toBe('新しい')
  })

  it('上限を超えたら古いものから押し出す（リソースを圧迫しない）', async () => {
    const store = new MemoryStore()
    const repo = new SyncLostRepository(store, 3)
    for (let i = 1; i <= 5; i++) await repo.save(entry(`structure:${i}`, i * 100))
    const list = await repo.list()
    expect(list.map((e) => e.syncId)).toEqual(['structure:5', 'structure:4', 'structure:3'])
    // 押し出した分はストアからも消える（キーが残らない）
    expect(await store.keys('synclost:')).toHaveLength(3)
  })

  it('作品（履歴が退避先）は内容を二重に持たず、記録だけを残せる', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save({ syncId: 'w1', at: 100, kind: 'work', reason: 'conflict', title: '銀の魚' })
    const list = await repo.list()
    expect(list[0]?.json).toBeUndefined()
    expect(list[0]?.title).toBe('銀の魚')
  })

  it('旧形式（`{at, json}` だけ）の退避もキーから種別を補って一覧に出す', async () => {
    const store = new MemoryStore()
    await store.set('synclost:structure:old', { at: 50, json: '{"id":"old"}' })
    const repo = new SyncLostRepository(store)
    const list = await repo.list()
    expect(list[0]).toMatchObject({ syncId: 'structure:old', kind: 'structure', at: 50 })
  })

  it('remove / clear で消せる', async () => {
    const repo = new SyncLostRepository(new MemoryStore())
    await repo.save(entry('structure:a', 100))
    await repo.save(entry('idea:b', 200, { kind: 'idea' }))
    await repo.remove('structure:a')
    expect(await repo.list()).toHaveLength(1)
    await repo.clear()
    expect(await repo.list()).toHaveLength(0)
  })
})
