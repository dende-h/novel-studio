import { describe, expect, it } from 'vitest'
import { heatmapScrollLeft } from './heatmap-scroll'

/** 画面と同じ寸法：マス 12px・間隔 4px・曜日ラベル列 28px＋間隔 4px・53 週。 */
const CELL = 12
const PITCH = 16
const LEADING = 32
const CONTENT = LEADING + 53 * PITCH - 4 // 876

const base = { pitch: PITCH, cell: CELL, leading: LEADING, content: CONTENT }

/** 左に留めた曜日ラベル列の幅。この下に入ったマスは隠れている。 */
const WEEKDAY_COL = 28

/** 今日のマスが見えている範囲（左の曜日ラベル列の右〜表示幅の右端）に収まるか。 */
const todayVisible = (weekIndex: number, viewport: number, scrollLeft: number) => {
  const left = LEADING + weekIndex * PITCH
  return left >= scrollLeft + WEEKDAY_COL && left + CELL <= scrollLeft + viewport
}

describe('heatmapScrollLeft', () => {
  it('今日が表示中の年に無い（過去の年）なら左端のまま', () => {
    expect(heatmapScrollLeft({ ...base, weekIndex: -1, viewport: 600 })).toBe(0)
  })

  it('はみ出していない広い画面では動かさない', () => {
    expect(heatmapScrollLeft({ ...base, weekIndex: 38, viewport: CONTENT })).toBe(0)
    expect(heatmapScrollLeft({ ...base, weekIndex: 38, viewport: 1200 })).toBe(0)
  })

  it('年の前半で今日が初めから見えているなら動かさない', () => {
    expect(heatmapScrollLeft({ ...base, weekIndex: 5, viewport: 600 })).toBe(0)
  })

  it('秋以降は今日の週が右端の少し手前（2 列ぶん）に来るまでずらす', () => {
    // 右端 = 32 + 38*16 + 12 = 652、余白 2 列 = 32 → 652 + 32 - 600 = 84
    const left = heatmapScrollLeft({ ...base, weekIndex: 38, viewport: 600 })
    expect(left).toBe(84)
    expect(todayVisible(38, 600, left)).toBe(true)
    // ずらす前（左端）では見えていなかった
    expect(todayVisible(38, 600, 0)).toBe(false)
  })

  it('年末の週は中身の終端で頭打ちにする（それ以上はスクロールできない）', () => {
    const left = heatmapScrollLeft({ ...base, weekIndex: 52, viewport: 600 })
    expect(left).toBe(CONTENT - 600)
    expect(todayVisible(52, 600, left)).toBe(true)
  })

  it('余白 0 列なら今日のマスの右端が表示幅の右端にそろう', () => {
    const left = heatmapScrollLeft({ ...base, weekIndex: 38, viewport: 600, trailingWeeks: 0 })
    expect(left + 600).toBe(LEADING + 38 * PITCH + CELL)
  })

  it('どの週・どの表示幅でも、今日のマスは見えている範囲に入る', () => {
    for (const viewport of [200, 320, 481, 700]) {
      for (let week = 0; week < 53; week++) {
        const left = heatmapScrollLeft({ ...base, weekIndex: week, viewport })
        expect(todayVisible(week, viewport, left)).toBe(true)
      }
    }
  })
})
