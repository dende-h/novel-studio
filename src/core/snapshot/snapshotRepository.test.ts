import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { MemoryStore } from '../storage/memoryStore'
import { SnapshotRepository } from './snapshotRepository'

const work = (id: string, title: string): Work => ({ id, title, episodes: [] })

const repo = (max?: number) => new SnapshotRepository(new MemoryStore(), max)

describe('SnapshotRepository（対 MemoryStore）', () => {
  it('append → list で新しい順に取得', async () => {
    const r = repo()
    await r.append(work('w1', 'v1'), 100, 's1')
    await r.append(work('w1', 'v2'), 200, 's2')
    const list = await r.list('w1')
    expect(list.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(list[0]?.work.title).toBe('v2')
  })

  it('max を超えると古いものから切り詰める', async () => {
    const r = repo(2)
    await r.append(work('w1', 'a'), 1, 's1')
    await r.append(work('w1', 'b'), 2, 's2')
    await r.append(work('w1', 'c'), 3, 's3')
    const list = await r.list('w1')
    expect(list.map((s) => s.id)).toEqual(['s3', 's2'])
  })

  it('別 work の履歴は独立', async () => {
    const r = repo()
    await r.append(work('w1', 'a'), 1, 's1')
    await r.append(work('w2', 'b'), 1, 's2')
    expect(await r.list('w1')).toHaveLength(1)
    expect(await r.list('w2')).toHaveLength(1)
  })

  it('未保存 work の list は []', async () => {
    expect(await repo().list('nope')).toEqual([])
  })

  it('clear で履歴を消す', async () => {
    const r = repo()
    await r.append(work('w1', 'a'), 1, 's1')
    await r.clear('w1')
    expect(await r.list('w1')).toEqual([])
  })

  it('append は Work の深いコピーを保持（後続変更の影響を受けない）', async () => {
    const r = repo()
    const w = work('w1', 'orig')
    await r.append(w, 1, 's1')
    w.title = 'mutated'
    const list = await r.list('w1')
    expect(list[0]?.work.title).toBe('orig')
  })
})
