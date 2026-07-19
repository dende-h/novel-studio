import { beforeEach, describe, expect, it } from 'vitest'
import { StructureRepository } from './structureRepository'
import type { KeyValueStore } from './types'

/** メモリ実装の KeyValueStore。 */
function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => {
      m.set(k, v)
    },
    delete: async (k) => {
      m.delete(k)
    },
    keys: async (prefix?: string) =>
      [...m.keys()].filter((k) => (prefix ? k.startsWith(prefix) : true)),
  }
}

describe('StructureRepository（構造レイヤーの永続化）', () => {
  let repo: StructureRepository
  beforeEach(() => {
    let n = 0
    let clock = 1000
    repo = new StructureRepository(
      memStore(),
      () => `s-${++n}`,
      () => (clock += 1000),
    )
  })

  it('create は空の構造を保存する', async () => {
    const s = await repo.create('w1', 'outline')
    expect(s).toMatchObject({ id: 's-1', workId: 'w1', kind: 'outline', nodes: [], edges: [] })
    expect(await repo.get('s-1')).toMatchObject({ id: 's-1', kind: 'outline' })
  })

  it('listByWork は指定作品の構造を updatedAt 降順で返す', async () => {
    await repo.create('w1', 'outline') // s-1, updatedAt=2000
    await repo.create('w1', 'mindmap') // s-2, updatedAt=3000
    await repo.create('w2', 'chart') // 別作品
    const list = await repo.listByWork('w1')
    expect(list.map((s) => s.kind)).toEqual(['mindmap', 'outline']) // 新しい順
  })

  it('save は updatedAt を進めて上書きする', async () => {
    const s = await repo.create('w1', 'chart')
    const updated = await repo.save({ ...s, title: '相関図A' })
    expect(updated.title).toBe('相関図A')
    expect(updated.updatedAt).toBeGreaterThan(s.updatedAt)
  })

  it('remove は削除する', async () => {
    const s = await repo.create('w1', 'outline')
    await repo.remove(s.id)
    expect(await repo.get(s.id)).toBeUndefined()
  })

  it('removeByWork は指定作品の構造だけ消す', async () => {
    await repo.create('w1', 'outline')
    await repo.create('w1', 'chart')
    const keep = await repo.create('w2', 'mindmap')
    await repo.removeByWork('w1')
    const all = await repo.list()
    expect(all.map((s) => s.id)).toEqual([keep.id])
  })

  it('replaceAll は既存を消してから全置換する（クラウド復元）', async () => {
    await repo.create('w1', 'outline')
    await repo.replaceAll([
      { id: 'x1', workId: 'w9', kind: 'mindmap', nodes: [], edges: [], updatedAt: 5 },
    ])
    const all = await repo.list()
    expect(all.map((s) => s.id)).toEqual(['x1'])
  })
})
