// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DailyActivity } from '../activity'
import { type ActivityDay, mergeActivity, toActivityDay } from './activityMerge'

const local = (date: string, added: number, removed = 0, saves = 1): DailyActivity => ({
  date,
  added,
  removed,
  net: added - removed,
  saves,
  updatedAt: 100,
})

const remote = (date: string, added: number, removed = 0, saves = 1): ActivityDay => ({
  date,
  added,
  removed,
  saves,
  updatedAt: 100,
})

describe('mergeActivity（日付ごと・フィールドごと max）', () => {
  it('フィールドごとに独立して max を取り、net を再計算する', () => {
    const { merged, changed } = mergeActivity(
      [local('2026-08-01', 100, 50, 3)],
      [remote('2026-08-01', 80, 70, 2)],
    )
    expect(changed).toBe(true)
    expect(merged).toEqual([
      { date: '2026-08-01', added: 100, removed: 70, saves: 3, net: 30, updatedAt: 100 },
    ])
  })

  it('リモートだけの日・ローカルだけの日が両方残り、日付昇順で返る', () => {
    const { merged } = mergeActivity([local('2026-08-03', 10)], [remote('2026-08-01', 20)])
    expect(merged.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-03'])
  })

  it('同値なら changed=false（書き込み省略の判定に使える）', () => {
    const l = [local('2026-08-01', 100)]
    const { changed } = mergeActivity(l, l.map(toActivityDay))
    expect(changed).toBe(false)
  })

  it('マージは可換・冪等（適用順序や二重適用で結果が変わらない）', () => {
    const a = [local('2026-08-01', 100, 20)]
    const b = [remote('2026-08-01', 60, 90)]
    const once = mergeActivity(a, b).merged
    const twice = mergeActivity(once, b).merged
    expect(twice).toEqual(once)
  })
})
