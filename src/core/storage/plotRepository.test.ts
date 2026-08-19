import { beforeEach, describe, expect, it } from 'vitest'
import { emptyPlot } from '../plot'
import { PlotRepository } from './plotRepository'
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

describe('PlotRepository（プロットの永続化）', () => {
  let repo: PlotRepository
  beforeEach(() => {
    let n = 0
    let clock = 1000
    repo = new PlotRepository(
      memStore(),
      () => `p-${++n}`,
      () => (clock += 1000),
    )
  })

  it('create はテンプレートから作成して保存する（id 指定で singleton 収束）', async () => {
    const p = await repo.create('w1', 'custom', undefined, 'w1:plot')
    expect(p).toMatchObject({ id: 'w1:plot', workId: 'w1', template: 'custom' })
    expect(p.sections).toHaveLength(1)
    expect(await repo.get('w1:plot')).toMatchObject({ id: 'w1:plot' })
  })

  it('テンプレート指定でガイド付きビートが入る', async () => {
    const p = await repo.create('w1', 'johakyu')
    expect(p.sections.map((s) => s.title)).toEqual(['序', '破', '急'])
    expect(p.beats.length).toBeGreaterThan(0)
  })

  it('listByWork は指定作品のプロットを updatedAt 降順で返す', async () => {
    await repo.create('w1', 'custom', '第1案') // updatedAt=2000
    await repo.create('w1', 'custom', '第2案') // updatedAt=3000
    await repo.create('w2', 'custom')
    const list = await repo.listByWork('w1')
    expect(list.map((p) => p.title)).toEqual(['第2案', '第1案'])
  })

  it('save は updatedAt を進め、put は刻印しない（同期 pull 用）', async () => {
    const p = await repo.create('w1', 'custom')
    const saved = await repo.save({ ...p, premise: '手紙の話' })
    expect(saved.updatedAt).toBeGreaterThan(p.updatedAt)
    const pulled = emptyPlot('px', 'w2', 777)
    await repo.put(pulled)
    expect((await repo.get('px'))?.updatedAt).toBe(777) // 他端末の時刻を保つ
  })

  it('remove / removeByWork / replaceAll', async () => {
    const a = await repo.create('w1', 'custom')
    await repo.create('w1', 'custom')
    const keep = await repo.create('w2', 'custom')
    await repo.remove(a.id)
    await repo.removeByWork('w1')
    expect((await repo.list()).map((p) => p.id)).toEqual([keep.id])
    await repo.replaceAll([emptyPlot('x1', 'w9', 5)])
    expect((await repo.list()).map((p) => p.id)).toEqual(['x1'])
  })
})
