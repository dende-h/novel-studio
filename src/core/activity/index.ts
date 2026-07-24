import { z } from 'zod'

/**
 * 執筆活動の集計（純ロジック・React/IDB 非依存）。
 * 日別に「書いた文字数（純増減・追加・削除）と保存回数」を持ち、GitHub 風の草
 * （ヒートマップ）／連続執筆日数（ストリーク）／合計をここで導出する。
 *
 * 日付キーは `YYYY-MM-DD`（ローカル日付）。カレンダー計算は UTC 正午アンカーで行い、
 * タイムゾーン/DST に依存せず決定的にする（テスト可能）。
 */

/** 日別の執筆活動 1 件（クラウドバックアップにも含めるため zod で検証可能にする）。 */
export const DailyActivitySchema = z.object({
  /** ローカル日付 `YYYY-MM-DD`。 */
  date: z.string(),
  /** その日に増えた文字数の合計（追加分のみ）。 */
  added: z.number(),
  /** その日に減った文字数の合計（削除分の絶対値）。 */
  removed: z.number(),
  /** 純増減（added - removed）。 */
  net: z.number(),
  /** その日の保存（＝執筆イベント）回数。 */
  saves: z.number(),
  /** 最終更新時刻（epoch ms）。 */
  updatedAt: z.number(),
})
export type DailyActivity = z.infer<typeof DailyActivitySchema>

/** ローカルの timestamp(ms) → `YYYY-MM-DD`（その端末の暦日）。 */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** `YYYY-MM-DD` を UTC 正午の Date へ（暦計算のアンカー・DST 非依存）。 */
function anchor(key: string): Date {
  const parts = key.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** 日付キーを n 日ずらす（負で過去）。 */
export function shiftDateKey(key: string, days: number): string {
  const a = anchor(key)
  a.setUTCDate(a.getUTCDate() + days)
  const y = a.getUTCFullYear()
  const m = `${a.getUTCMonth() + 1}`.padStart(2, '0')
  const d = `${a.getUTCDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 曜日（0=日〜6=土）。 */
export function dayOfWeek(key: string): number {
  return anchor(key).getUTCDay()
}

/** a→b の日数差（UTC アンカーで DST 非依存）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((anchor(b).getTime() - anchor(a).getTime()) / 86_400_000)
}

/** 執筆イベント 1 件を当日レコードへ適用（純関数）。prev 無しは新規作成。 */
export function applyDelta(
  prev: DailyActivity | undefined,
  date: string,
  deltaChars: number,
  at: number,
): DailyActivity {
  const base = prev ?? { date, added: 0, removed: 0, net: 0, saves: 0, updatedAt: at }
  return {
    date,
    added: base.added + Math.max(0, deltaChars),
    removed: base.removed + Math.max(0, -deltaChars),
    net: base.net + deltaChars,
    saves: base.saves + 1,
    updatedAt: at,
  }
}

/**
 * 連続執筆日数（今日を起点に遡る）。今日がまだ未執筆でも、昨日が活動していれば
 * ストリークは「生きている」ものとして昨日から数える（一日経つまで途切れない）。
 */
export function currentStreak(activeDays: ReadonlySet<string>, todayKey: string): number {
  let cursor = todayKey
  if (!activeDays.has(cursor)) {
    cursor = shiftDateKey(cursor, -1)
    if (!activeDays.has(cursor)) return 0
  }
  let n = 0
  while (activeDays.has(cursor)) {
    n++
    cursor = shiftDateKey(cursor, -1)
  }
  return n
}

/** 過去最長の連続執筆日数。 */
export function longestStreak(activeDays: ReadonlySet<string>): number {
  const sorted = [...activeDays].sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const day of sorted) {
    run = prev !== null && shiftDateKey(prev, 1) === day ? run + 1 : 1
    if (run > best) best = run
    prev = day
  }
  return best
}

/** 草の濃さ（0〜4）。小説の一日として現実的な閾値。 */
export function activityLevel(chars: number): 0 | 1 | 2 | 3 | 4 {
  if (chars <= 0) return 0
  if (chars < 200) return 1
  if (chars < 600) return 2
  if (chars < 1500) return 3
  return 4
}

export interface HeatCell {
  date: string
  chars: number
  level: 0 | 1 | 2 | 3 | 4
  /** 未来日（グリッド埋め用のプレースホルダ）。 */
  future?: boolean
  /** 表示対象の年の外（前後月の埋めマス）。 */
  outOfRange?: boolean
}

/**
 * GitHub 風のヒートマップ。endKey を含む週で終わる numWeeks 列（各列は日〜土の 7 マス）。
 * 各セルの chars は net（純増減）を採用し、当日以降の未来マスは future=true にする。
 */
export function buildHeatmap(
  netByDate: ReadonlyMap<string, number>,
  endKey: string,
  numWeeks: number,
): HeatCell[][] {
  // endKey を含む週の土曜日をグリッド末尾に置く。
  const endGrid = shiftDateKey(endKey, 6 - dayOfWeek(endKey))
  const startGrid = shiftDateKey(endGrid, -(numWeeks * 7 - 1))
  const weeks: HeatCell[][] = []
  for (let w = 0; w < numWeeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = shiftDateKey(startGrid, w * 7 + d)
      const chars = netByDate.get(key) ?? 0
      col.push({
        date: key,
        chars,
        level: activityLevel(chars),
        ...(key > endKey ? { future: true } : {}),
      })
    }
    weeks.push(col)
  }
  return weeks
}

/**
 * 指定した暦年（1/1〜12/31）を GitHub 風グリッドにする。日〜土の 7 行で、年の前後に
 * はみ出す埋めマスは outOfRange、当日より後は future を立てる（表示側で薄く/非表示にする）。
 */
export function buildYear(
  netByDate: ReadonlyMap<string, number>,
  year: number,
  todayKey: string,
): HeatCell[][] {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const gridStart = shiftDateKey(start, -dayOfWeek(start)) // 1/1 を含む週の日曜
  const gridEnd = shiftDateKey(end, 6 - dayOfWeek(end)) // 12/31 を含む週の土曜
  const numWeeks = Math.round(daysBetween(gridStart, gridEnd) / 7) + 1
  const weeks: HeatCell[][] = []
  for (let w = 0; w < numWeeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = shiftDateKey(gridStart, w * 7 + d)
      const chars = netByDate.get(key) ?? 0
      col.push({
        date: key,
        chars,
        level: activityLevel(chars),
        ...(key > todayKey ? { future: true } : {}),
        ...(key < start || key > end ? { outOfRange: true } : {}),
      })
    }
    weeks.push(col)
  }
  return weeks
}

/**
 * 各週列の月ラベル（その週に「1日」を含む列にだけ月番号を置く）。それ以外は null。
 * 表示側で `${n}月` にする。範囲外（前後年）の 1 日は無視。
 */
export function monthLabels(weeks: readonly HeatCell[][]): (number | null)[] {
  return weeks.map((wk) => {
    const first = wk.find((c) => !c.outOfRange && c.date.endsWith('-01'))
    return first ? Number(first.date.split('-')[1]) : null
  })
}

/** データと今年から、切り替え可能な年（新しい順）を作る。データが無くても今年は含む。 */
export function availableYears(days: readonly DailyActivity[], currentYear: number): number[] {
  const years = new Set<number>([currentYear])
  for (const d of days) years.add(Number(d.date.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
}

export interface ActivitySummary {
  /** 通算の純増減（＝おおよその現在の総文字数の増分）。 */
  totalNet: number
  /** 活動した日数。 */
  activeDays: number
  /** 現在の連続執筆日数。 */
  streak: number
  /** 過去最長の連続執筆日数。 */
  longest: number
  /** 今日の純増減。 */
  today: number
}

/** 日別レコード一覧から画面表示用のサマリを作る。 */
export function summarize(days: readonly DailyActivity[], todayKey: string): ActivitySummary {
  const active = new Set(days.filter((d) => d.net !== 0 || d.saves > 0).map((d) => d.date))
  const today = days.find((d) => d.date === todayKey)
  return {
    totalNet: days.reduce((n, d) => n + d.net, 0),
    activeDays: active.size,
    streak: currentStreak(active, todayKey),
    longest: longestStreak(active),
    today: today?.net ?? 0,
  }
}
