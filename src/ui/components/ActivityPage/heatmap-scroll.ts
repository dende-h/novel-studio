/**
 * 年カレンダー（草）の横スクロール位置の計算。jsdom にはレイアウトが無いので、
 * DOM の実測値（表示幅・中身の幅）を受け取って scrollLeft を返す純関数に切り出している。
 */
export interface HeatmapScrollInput {
  /** 今日を含む週列の番号（0 始まり）。表示中の年に今日が無ければ -1。 */
  weekIndex: number
  /** 1 列の送り幅（マス幅＋列の間隔）。 */
  pitch: number
  /** マス 1 つの幅。 */
  cell: number
  /** 週列 0 の左端までの距離（曜日ラベル列＋間隔）。 */
  leading: number
  /** スクロール領域の見えている幅（clientWidth）。 */
  viewport: number
  /** スクロール領域の中身の幅（scrollWidth）。 */
  content: number
  /** 今日の週の右に残す余白（列数）。右端ぴったりではなく少し手前に置く。 */
  trailingWeeks?: number
}

/**
 * 今日の週が右端の少し手前に見える scrollLeft を返す。
 * はみ出していない・今日が表示中の年に無いときは 0（左端＝1 月のまま）。
 * 中身の終端を越えてはスクロールできないので、最大値で頭打ちにする。
 */
export function heatmapScrollLeft({
  weekIndex,
  pitch,
  cell,
  leading,
  viewport,
  content,
  trailingWeeks = 2,
}: HeatmapScrollInput): number {
  const max = content - viewport
  if (weekIndex < 0 || max <= 0) return 0
  const todayRight = leading + weekIndex * pitch + cell
  const target = todayRight + trailingWeeks * pitch - viewport
  return Math.min(max, Math.max(0, Math.round(target)))
}
