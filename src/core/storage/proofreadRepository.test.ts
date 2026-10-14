import { beforeEach, describe, expect, it } from 'vitest'
import type { ProofreadRecord } from '../proofread/decisions'
import { MemoryStore } from './memoryStore'
import { ProofreadRepository, proofreadIdOf } from './proofreadRepository'

const record = (
  workId: string,
  episodeId: string,
  updatedAt = 100,
  verdict = 'fix',
): ProofreadRecord => ({
  workId,
  episodeId,
  decisions: [
    {
      blockId: 'b1',
      code: 'variant',
      text: '出来る',
      nth: 0,
      occurrence: 0,
      anchor: 'contains',
      verdict,
      decidedAt: updatedAt,
    },
  ],
  updatedAt,
})

describe('ProofreadRepository（推敲の判断の永続化）', () => {
  let store: MemoryStore
  let repo: ProofreadRepository
  beforeEach(() => {
    store = new MemoryStore()
    repo = new ProofreadRepository(store)
  })

  it('proofreadIdOf は workId+episodeId の決定的合成', () => {
    expect(proofreadIdOf('w1', 'e1')).toBe('w1:e1')
  })

  it('save → get / getById で往復し、キーは proofread:<workId>:<episodeId>', async () => {
    await repo.save(record('w1', 'e1'))
    expect(await repo.get('w1', 'e1')).toEqual(record('w1', 'e1'))
    expect(await repo.getById('w1:e1')).toEqual(record('w1', 'e1'))
    expect(await store.keys('proofread:')).toEqual(['proofread:w1:e1'])
  })

  it('無い話の get は undefined', async () => {
    expect(await repo.get('w1', 'nope')).toBeUndefined()
  })

  it('save・put は updatedAt を刻印しない（LWW の時計を進めない）', async () => {
    await repo.save(record('w1', 'e1', 42))
    expect((await repo.get('w1', 'e1'))?.updatedAt).toBe(42)
    await repo.put(record('w1', 'e1', 7))
    expect((await repo.get('w1', 'e1'))?.updatedAt).toBe(7)
  })

  it('同じ話への save は同じレコードに収束する（決定的 id）', async () => {
    await repo.save(record('w1', 'e1', 1))
    await repo.save(record('w1', 'e1', 2, 'keep'))
    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get('w1', 'e1'))?.decisions[0]?.verdict).toBe('keep')
  })

  it('未知の verdict・code・anchor も落とさずに読む', async () => {
    await store.set('proofread:w1:e1', {
      workId: 'w1',
      episodeId: 'e1',
      decisions: [
        { blockId: 'b1', code: 'future', text: 'x', anchor: 'odd', verdict: 'later', decidedAt: 1 },
      ],
      updatedAt: 1,
    })
    const got = await repo.get('w1', 'e1')
    expect(got?.decisions[0]).toMatchObject({
      code: 'future',
      anchor: 'odd',
      verdict: 'later',
      nth: 0,
    })
  })

  it('decisions の無い旧形式は空の判断として読む', async () => {
    await store.set('proofread:w1:e1', { workId: 'w1', episodeId: 'e1', updatedAt: 1 })
    expect((await repo.get('w1', 'e1'))?.decisions).toEqual([])
  })

  it('壊れたレコードは undefined として扱い、list にも出さない（消さない）', async () => {
    await store.set('proofread:w1:e1', { workId: 'w1' }) // episodeId・updatedAt が無い
    await store.set('proofread:w1:e2', 'not an object')
    await repo.save(record('w1', 'e3'))
    expect(await repo.get('w1', 'e1')).toBeUndefined()
    expect(await repo.getById('w1:e2')).toBeUndefined()
    expect((await repo.list()).map((r) => r.episodeId)).toEqual(['e3'])
    // 読めないだけで、ストアからは消していない
    expect(await store.get('proofread:w1:e1')).toEqual({ workId: 'w1' })
  })

  it('listByWork は作品の判断だけを返す', async () => {
    await repo.save(record('w1', 'e1'))
    await repo.save(record('w1', 'e2'))
    await repo.save(record('w2', 'e1'))
    expect((await repo.listByWork('w1')).map((r) => r.episodeId).sort()).toEqual(['e1', 'e2'])
  })

  it('remove / removeById / removeByWork で消え、ほかの作品は残る', async () => {
    await repo.save(record('w1', 'e1'))
    await repo.save(record('w1', 'e2'))
    await repo.save(record('w1', 'e3'))
    await repo.save(record('w2', 'e1'))
    await repo.remove('w1', 'e1')
    expect(await repo.get('w1', 'e1')).toBeUndefined()
    await repo.removeById('w1:e2')
    expect(await repo.get('w1', 'e2')).toBeUndefined()
    await repo.removeByWork('w1')
    expect(await repo.listByWork('w1')).toHaveLength(0)
    expect(await repo.get('w2', 'e1')).toBeDefined()
  })

  it('ほかの種類のレコード（staging: など）には触れない', async () => {
    await store.set('staging:w1:e1', { workId: 'w1', episodeId: 'e1', cues: [], updatedAt: 1 })
    await repo.save(record('w1', 'e1'))
    await repo.removeByWork('w1')
    await repo.replaceAll([])
    expect(await store.get('staging:w1:e1')).toBeDefined()
  })

  it('replaceAll は既存を消してから書き込む（バックアップ復元）', async () => {
    await repo.save(record('w1', 'e1'))
    await store.set('proofread:w1:broken', { broken: true })
    await repo.replaceAll([record('w9', 'e9')])
    expect(await repo.list()).toEqual([record('w9', 'e9')])
    expect(await store.keys('proofread:')).toEqual(['proofread:w9:e9'])
  })
})

describe('listRaw（同期の列挙用）', () => {
  it('読めないレコードも id ごと生のまま返す', async () => {
    const store = new MemoryStore()
    const repo = new ProofreadRepository(store)
    await store.set('proofread:w1:e1', { broken: true })
    await repo.save({ workId: 'w1', episodeId: 'e2', decisions: [], updatedAt: 1 })
    const rows = await repo.listRaw()
    expect(rows.map((r) => r.id).sort()).toEqual(['w1:e1', 'w1:e2'])
    expect(rows.find((r) => r.id === 'w1:e1')?.raw).toEqual({ broken: true })
  })
})
