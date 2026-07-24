import { beforeEach, describe, expect, it } from 'vitest'
import { ActivityRepository } from './activityRepository'
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

const at = (y: number, mo: number, d: number) => new Date(y, mo - 1, d, 10).getTime()

describe('ActivityRepository', () => {
  let repo: ActivityRepository
  beforeEach(() => {
    repo = new ActivityRepository(memStore())
  })

  it('同日への複数記録は 1 レコードへ積み上がる', async () => {
    await repo.record(100, at(2026, 7, 12))
    await repo.record(-30, at(2026, 7, 12))
    const rows = await repo.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      date: '2026-07-12',
      added: 100,
      removed: 30,
      net: 70,
      saves: 2,
    })
  })

  it('別日は別レコード、list は日付昇順', async () => {
    await repo.record(50, at(2026, 7, 13))
    await repo.record(80, at(2026, 7, 11))
    const rows = await repo.list()
    expect(rows.map((r) => r.date)).toEqual(['2026-07-11', '2026-07-13'])
  })

  it('delta 0 は記録しない', async () => {
    expect(await repo.record(0, at(2026, 7, 12))).toBeNull()
    expect(await repo.list()).toHaveLength(0)
  })

  it('replaceAll は既存を消してから全置換する（クラウド復元）', async () => {
    await repo.record(10, at(2026, 7, 1))
    await repo.replaceAll([
      { date: '2026-07-05', added: 5, removed: 0, net: 5, saves: 1, updatedAt: 1 },
      { date: '2026-07-06', added: 8, removed: 0, net: 8, saves: 1, updatedAt: 2 },
    ])
    const rows = await repo.list()
    expect(rows.map((r) => r.date)).toEqual(['2026-07-05', '2026-07-06']) // 07-01 は消えている
  })
})
