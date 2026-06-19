import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { MemoryStore } from './memoryStore'
import { WorkRepository } from './workRepository'

const work = (id: string, title: string): Work => ({
  id,
  title,
  episodes: [
    {
      id: 'e1',
      title: '第一話',
      blocks: [
        { id: 'b1', type: 'paragraph', inlines: [{ type: 'emphasisDots', text: '重要' }] },
        { id: 'b2', type: 'sceneBreak' },
      ],
    },
  ],
})

const repo = () => new WorkRepository(new MemoryStore())

describe('WorkRepository（対 MemoryStore）', () => {
  it('saveWork → getWork で同一 Work を復元', async () => {
    const r = repo()
    const w = work('w1', 'A')
    await r.saveWork(w)
    expect(await r.getWork('w1')).toEqual(w)
  })

  it('getWork(存在しないid) は undefined', async () => {
    expect(await repo().getWork('nope')).toBeUndefined()
  })

  it('saveWork は既存 id を上書き（後勝ち）', async () => {
    const r = repo()
    await r.saveWork(work('w1', 'v1'))
    await r.saveWork(work('w1', 'v2'))
    expect((await r.getWork('w1'))?.title).toBe('v2')
  })

  it('listWorks は保存済み全件の要約(id,title,話数,文字数)', async () => {
    const r = repo()
    await r.saveWork(work('w1', 'A'))
    await r.saveWork(work('w2', 'B'))
    const list = (await r.listWorks()).sort((a, b) => a.id.localeCompare(b.id))
    // work() は 1話・傍点「重要」(2文字) を持つ
    expect(list).toEqual([
      { id: 'w1', title: 'A', episodeCount: 1, charCount: 2 },
      { id: 'w2', title: 'B', episodeCount: 1, charCount: 2 },
    ])
  })

  it('listWorks（0件） は []', async () => {
    expect(await repo().listWorks()).toEqual([])
  })

  it('listWorks は表紙画像(coverImage)を要約に含める（ライブラリカード表示用）', async () => {
    const r = repo()
    await r.saveWork({ ...work('w1', 'A'), coverImage: 'data:image/jpeg;base64,SGk=' })
    const [summary] = await r.listWorks()
    expect(summary?.coverImage).toBe('data:image/jpeg;base64,SGk=')
  })

  it('deleteWork → getWork=undefined・listWorks から消える', async () => {
    const r = repo()
    await r.saveWork(work('w1', 'A'))
    await r.deleteWork('w1')
    expect(await r.getWork('w1')).toBeUndefined()
    expect(await r.listWorks()).toEqual([])
  })

  it('作品>話>block（傍点含む）の入れ子が無損失で往復', async () => {
    const r = repo()
    const w = work('w1', 'A')
    await r.saveWork(w)
    expect(await r.getWork('w1')).toEqual(w)
  })
})
