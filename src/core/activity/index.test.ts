import { describe, expect, it } from 'vitest'
import {
  activityLevel,
  applyDelta,
  availableYears,
  buildHeatmap,
  buildYear,
  currentStreak,
  type DailyActivity,
  dayOfWeek,
  daysBetween,
  localDateKey,
  longestStreak,
  monthLabels,
  shiftDateKey,
  summarize,
} from './index'

const day = (over: Partial<DailyActivity> & { date: string }): DailyActivity => ({
  added: 0,
  removed: 0,
  net: 0,
  saves: 1,
  updatedAt: 0,
  ...over,
})

describe('カレンダー計算（UTC アンカー・DST 非依存）', () => {
  it('shiftDateKey は月/年またぎ・うるう年も正しい', () => {
    expect(shiftDateKey('2026-07-12', 1)).toBe('2026-07-13')
    expect(shiftDateKey('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29') // うるう年
  })

  it('dayOfWeek は 0=日〜6=土', () => {
    expect(dayOfWeek('2026-07-12')).toBe(0) // 日曜
    expect(dayOfWeek('2026-07-18')).toBe(6) // 土曜
  })

  it('localDateKey は YYYY-MM-DD 形式', () => {
    expect(localDateKey(new Date(2026, 6, 5, 9, 0).getTime())).toBe('2026-07-05')
  })
})

describe('applyDelta', () => {
  it('追加・削除・保存回数を積み上げる', () => {
    let rec = applyDelta(undefined, '2026-07-12', 120, 10)
    expect(rec).toMatchObject({ added: 120, removed: 0, net: 120, saves: 1 })
    rec = applyDelta(rec, '2026-07-12', -30, 20)
    expect(rec).toMatchObject({ added: 120, removed: 30, net: 90, saves: 2, updatedAt: 20 })
  })
})

describe('ストリーク', () => {
  it('今日が活動していれば今日を含めて連続日数', () => {
    const s = new Set(['2026-07-10', '2026-07-11', '2026-07-12'])
    expect(currentStreak(s, '2026-07-12')).toBe(3)
  })

  it('今日未執筆でも昨日が活動なら生きている（昨日から数える）', () => {
    const s = new Set(['2026-07-10', '2026-07-11'])
    expect(currentStreak(s, '2026-07-12')).toBe(2)
  })

  it('今日も昨日も無ければ 0（途切れ）', () => {
    const s = new Set(['2026-07-09'])
    expect(currentStreak(s, '2026-07-12')).toBe(0)
  })

  it('longestStreak は最長の連続区間', () => {
    const s = new Set([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03', // 3連続
      '2026-07-10',
      '2026-07-11', // 2連続
    ])
    expect(longestStreak(s)).toBe(3)
  })
})

describe('ヒートマップ', () => {
  it('level は文字数の閾値で決まる', () => {
    expect(activityLevel(0)).toBe(0)
    expect(activityLevel(100)).toBe(1)
    expect(activityLevel(300)).toBe(2)
    expect(activityLevel(1000)).toBe(3)
    expect(activityLevel(2000)).toBe(4)
  })

  it('numWeeks 列 × 7 行、末尾は今日を含む週、未来はプレースホルダ', () => {
    const net = new Map([['2026-07-12', 500]])
    const grid = buildHeatmap(net, '2026-07-12', 4) // 今日=日曜
    expect(grid).toHaveLength(4)
    expect(grid.every((col) => col.length === 7)).toBe(true)
    // 今日（日曜）は最終列の先頭
    const last = grid[3] as NonNullable<(typeof grid)[number]>
    expect(last[0]?.date).toBe('2026-07-12')
    expect(last[0]?.level).toBe(2)
    // 今日より後は future
    expect(last[1]?.future).toBe(true)
  })
})

describe('summarize', () => {
  it('合計・活動日数・ストリークをまとめる', () => {
    const days = [
      day({ date: '2026-07-10', net: 300 }),
      day({ date: '2026-07-11', net: 500 }),
      day({ date: '2026-07-12', net: 200 }),
    ]
    const s = summarize(days, '2026-07-12')
    expect(s).toMatchObject({ totalNet: 1000, activeDays: 3, streak: 3, today: 200 })
  })
})

describe('年カレンダー', () => {
  it('daysBetween は暦日数の差', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('buildYear は 7 行・全列で、年頭/年末の埋めは outOfRange、当日以降は future', () => {
    const net = new Map([['2026-03-02', 500]])
    const grid = buildYear(net, 2026, '2026-07-12')
    expect(grid.every((col) => col.length === 7)).toBe(true)
    // 先頭列の日曜は 2025-12-28（1/1 の週）＝範囲外
    expect(grid[0]?.[0]?.date).toBe('2025-12-28')
    expect(grid[0]?.[0]?.outOfRange).toBe(true)
    // 3/2 のマスは記録あり
    const march2 = grid.flat().find((c) => c.date === '2026-03-02')
    expect(march2?.level).toBe(2)
    // 12/31 より後（年末の埋め）や当日以降は future/outOfRange
    const dec31 = grid.flat().find((c) => c.date === '2026-12-31')
    expect(dec31?.future).toBe(true)
  })

  it('monthLabels は「1日を含む週」にだけ月番号を置く', () => {
    const grid = buildYear(new Map(), 2026, '2026-12-31')
    const labels = monthLabels(grid).filter((m): m is number => m != null)
    expect(labels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('availableYears はデータ＋今年を新しい順（今年は常に含む）', () => {
    const days = [day({ date: '2024-05-01', net: 1 }), day({ date: '2025-01-01', net: 1 })]
    expect(availableYears(days, 2026)).toEqual([2026, 2025, 2024])
    expect(availableYears([], 2026)).toEqual([2026])
  })
})
