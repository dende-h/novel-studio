import { beforeEach, describe, expect, it } from 'vitest'
import type { Staging } from '../game'
import { StagingRepository, stagingIdOf } from './stagingRepository'
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

const staging = (workId: string, episodeId: string, updatedAt = 100): Staging => ({
  workId,
  episodeId,
  cues: [{ blockId: 'b1', speaker: '灯' }],
  updatedAt,
})

describe('StagingRepository（演出譜の永続化）', () => {
  let repo: StagingRepository
  beforeEach(() => {
    repo = new StagingRepository(memStore())
  })

  it('stagingIdOf は workId+episodeId の決定的合成', () => {
    expect(stagingIdOf('w1', 'e1')).toBe('w1:e1')
  })

  it('save → get / getById で往復する', async () => {
    await repo.save(staging('w1', 'e1'))
    expect(await repo.get('w1', 'e1')).toMatchObject({ workId: 'w1', episodeId: 'e1' })
    expect(await repo.getById('w1:e1')).toMatchObject({ episodeId: 'e1' })
  })

  it('save は updatedAt を刻印しない（patchCue 側の時刻を保つ＝LWW を壊さない）', async () => {
    await repo.save(staging('w1', 'e1', 42))
    expect((await repo.get('w1', 'e1'))?.updatedAt).toBe(42)
  })

  it('同じ話への save は同じレコードに収束する（決定的 id）', async () => {
    await repo.save(staging('w1', 'e1', 1))
    await repo.save(staging('w1', 'e1', 2))
    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get('w1', 'e1'))?.updatedAt).toBe(2)
  })

  it('listByWork は作品の演出譜だけを返す', async () => {
    await repo.save(staging('w1', 'e1'))
    await repo.save(staging('w1', 'e2'))
    await repo.save(staging('w2', 'e1'))
    expect(await repo.listByWork('w1')).toHaveLength(2)
  })

  it('remove / removeByWork で消える', async () => {
    await repo.save(staging('w1', 'e1'))
    await repo.save(staging('w1', 'e2'))
    await repo.save(staging('w2', 'e1'))
    await repo.remove('w1', 'e1')
    expect(await repo.get('w1', 'e1')).toBeUndefined()
    await repo.removeByWork('w1')
    expect(await repo.listByWork('w1')).toHaveLength(0)
    expect(await repo.get('w2', 'e1')).toBeDefined()
  })

  it('replaceAll は既存を消してから書き込む（バックアップ復元）', async () => {
    await repo.save(staging('w1', 'e1'))
    await repo.replaceAll([staging('w9', 'e9')])
    const all = await repo.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ workId: 'w9' })
  })
})
