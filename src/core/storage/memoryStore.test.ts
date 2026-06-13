import { describe, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'

describe('MemoryStore（KeyValueStore contract）', () => {
  it('set → get で値往復', async () => {
    const s = new MemoryStore()
    await s.set('k', { a: 1 })
    expect(await s.get('k')).toEqual({ a: 1 })
  })

  it('get(未存在) は undefined', async () => {
    expect(await new MemoryStore().get('none')).toBeUndefined()
  })

  it('delete 後 get は undefined', async () => {
    const s = new MemoryStore()
    await s.set('k', 1)
    await s.delete('k')
    expect(await s.get('k')).toBeUndefined()
  })

  it('keys(prefix) で前方一致一覧', async () => {
    const s = new MemoryStore()
    await s.set('work:1', 1)
    await s.set('work:2', 2)
    await s.set('ep:1', 3)
    expect((await s.keys('work:')).sort()).toEqual(['work:1', 'work:2'])
  })

  it('set で上書き（後勝ち）', async () => {
    const s = new MemoryStore()
    await s.set('k', 'a')
    await s.set('k', 'b')
    expect(await s.get('k')).toBe('b')
  })

  it('get はコピーを返す（保存値が外部変更から隔離）', async () => {
    const s = new MemoryStore()
    await s.set('k', { a: 1 })
    const got = await s.get<{ a: number }>('k')
    if (got) got.a = 99
    expect((await s.get<{ a: number }>('k'))?.a).toBe(1)
  })
})
