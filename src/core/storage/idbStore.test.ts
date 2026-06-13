import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IdbStore } from './idbStore'

let dbn = 0
const fresh = () => new IdbStore(`test-db-${++dbn}`)

describe('IdbStore（KeyValueStore contract / IndexedDB）', () => {
  it('set → get で値往復', async () => {
    const s = fresh()
    await s.set('k', { a: 1 })
    expect(await s.get('k')).toEqual({ a: 1 })
  })

  it('get(未存在) は undefined', async () => {
    expect(await fresh().get('none')).toBeUndefined()
  })

  it('delete 後 get は undefined', async () => {
    const s = fresh()
    await s.set('k', 1)
    await s.delete('k')
    expect(await s.get('k')).toBeUndefined()
  })

  it('keys(prefix) で前方一致一覧', async () => {
    const s = fresh()
    await s.set('work:1', 1)
    await s.set('work:2', 2)
    await s.set('ep:1', 3)
    expect((await s.keys('work:')).sort()).toEqual(['work:1', 'work:2'])
  })

  it('keys() は全件', async () => {
    const s = fresh()
    await s.set('a', 1)
    await s.set('b', 2)
    expect((await s.keys()).sort()).toEqual(['a', 'b'])
  })

  it('set で上書き（後勝ち）', async () => {
    const s = fresh()
    await s.set('k', 'a')
    await s.set('k', 'b')
    expect(await s.get('k')).toBe('b')
  })

  it('同名 DB の別インスタンスで永続化（再読込で復元）', async () => {
    const name = `persist-${++dbn}`
    const a = new IdbStore(name)
    await a.set('work:1', { title: '夜' })
    const b = new IdbStore(name)
    expect(await b.get('work:1')).toEqual({ title: '夜' })
  })
})
