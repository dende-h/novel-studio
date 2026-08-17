import type { DailyActivity } from '../activity'

/**
 * 執筆の記録（日別活動）のマージ純ロジック。
 *
 * 日別カウンタは端末ごとに単調増加する加算的データなので、LWW ではなく
 * **日付ごと・フィールドごとの max** でマージする（衝突が原理的に起きない・base/409 不要）。
 * net は保存・送信せず added - removed から導出し、値の食い違いを持ち込まない。
 * 同一日に複数端末で書いた場合は合算でなく大きい方が残る（過少方向・草/ストリーク用途で実害なし）。
 */

/** サーバとやり取りする 1 日ぶんの形（net を含まない）。 */
export interface ActivityDay {
  date: string
  added: number
  removed: number
  saves: number
  updatedAt: number
}

/** ローカルの DailyActivity → 送信形（net を落とす）。 */
export function toActivityDay(d: DailyActivity): ActivityDay {
  return {
    date: d.date,
    added: d.added,
    removed: d.removed,
    saves: d.saves,
    updatedAt: d.updatedAt,
  }
}

/**
 * ローカルとサーバ応答を日付ごと max でマージする。日付昇順で返し、
 * ローカルと同値なら changed=false（呼び出し側は書き込みを省略できる）。
 */
export function mergeActivity(
  local: DailyActivity[],
  remote: ActivityDay[],
): { merged: DailyActivity[]; changed: boolean } {
  const byDate = new Map<string, DailyActivity>()
  for (const d of local) byDate.set(d.date, d)
  let changed = false
  for (const r of remote) {
    const l = byDate.get(r.date)
    const added = Math.max(l?.added ?? 0, r.added)
    const removed = Math.max(l?.removed ?? 0, r.removed)
    const saves = Math.max(l?.saves ?? 0, r.saves)
    const updatedAt = Math.max(l?.updatedAt ?? 0, r.updatedAt)
    const next: DailyActivity = {
      date: r.date,
      added,
      removed,
      saves,
      net: added - removed,
      updatedAt,
    }
    if (
      !l ||
      l.added !== next.added ||
      l.removed !== next.removed ||
      l.saves !== next.saves ||
      l.net !== next.net ||
      l.updatedAt !== next.updatedAt
    ) {
      changed = true
    }
    byDate.set(r.date, next)
  }
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { merged, changed }
}
