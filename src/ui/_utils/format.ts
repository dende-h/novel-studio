/** 表示用フォーマッタ（純粋・DOM 非依存）。 */

/** 相対時刻表記（たった今 / N分前 / N時間前 / 月日 時:分）。 */
export function formatRelative(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/** 桁区切り（1234 → 1,234）。 */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
