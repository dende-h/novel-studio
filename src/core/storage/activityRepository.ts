import { applyDelta, type DailyActivity, localDateKey } from '../activity'
import type { KeyValueStore } from './types'

/**
 * 執筆活動（日別）の永続化。KeyValueStore に `activity:YYYY-MM-DD` で 1 日 1 レコードを持つ。
 * 保存（本文の変化）ごとに文字数の純増減を当日レコードへ積む。純ローカル（同期・課金と無関係）。
 */
const PREFIX = 'activity:'
const keyOf = (date: string) => `${PREFIX}${date}`

export class ActivityRepository {
  constructor(private store: KeyValueStore) {}

  /** 本文の純増減(deltaChars) を at の暦日へ記録する。0 なら何もしない。 */
  async record(deltaChars: number, at: number): Promise<DailyActivity | null> {
    if (deltaChars === 0) return null
    const date = localDateKey(at)
    const prev = await this.store.get<DailyActivity>(keyOf(date))
    const next = applyDelta(prev, date, deltaChars, at)
    await this.store.set(keyOf(date), next)
    return next
  }

  /** 全期間の日別レコード（日付昇順）。 */
  async list(): Promise<DailyActivity[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<DailyActivity>(k)))
    return rows
      .filter((r): r is DailyActivity => r != null)
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /** 執筆活動を全置換する（クラウド復元用・既存を消してから書き込む）。 */
  async replaceAll(days: DailyActivity[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(days.map((d) => this.store.set(keyOf(d.date), d)))
  }
}
