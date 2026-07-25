/// <reference types="@cloudflare/workers-types" />
/**
 * テスト用の in-memory D1 フェイク（subscriptions テーブルのみ）。membership / webhook / reap の
 * テストで共有する。SQL 文字列の部分一致でクエリを分岐する簡易実装。
 */
import type { SubscriptionRow } from './membership'

export function makeSubsDb(seed: SubscriptionRow[] = []) {
  const rows = new Map<string, SubscriptionRow>()
  for (const r of seed) rows.set(r.user_id, r)

  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('stripe_customer_id = ?')) {
            for (const r of rows.values()) if (r.stripe_customer_id === args[0]) return r as T
            return null
          }
          // user_id = ?（SELECT * / SELECT status いずれも user_id で引く）
          return (rows.get(args[0] as string) ?? null) as unknown as T | null
        },
        async run() {
          if (sql.startsWith('INSERT INTO subscriptions')) {
            const [
              user_id,
              stripe_customer_id,
              stripe_subscription_id,
              status,
              price_id,
              current_period_end,
              grace_until,
              updated_at,
            ] = args as [
              string,
              string,
              string | null,
              string,
              string | null,
              number,
              number,
              number,
            ]
            // 本番 SQL の COALESCE / CASE と同じ保持セマンティクス（null/0 は既存値を残す）。
            const prev = rows.get(user_id)
            rows.set(user_id, {
              user_id,
              stripe_customer_id,
              stripe_subscription_id:
                stripe_subscription_id ?? prev?.stripe_subscription_id ?? null,
              status,
              price_id: price_id ?? prev?.price_id ?? null,
              current_period_end:
                current_period_end > 0 ? current_period_end : (prev?.current_period_end ?? 0),
              grace_until,
              updated_at,
            })
          } else if (sql.startsWith('UPDATE subscriptions SET grace_until = 0')) {
            const [, userId] = args as [number, string]
            const r = rows.get(userId)
            if (r) rows.set(userId, { ...r, grace_until: 0 })
          }
          return { success: true }
        },
        async all<T>(): Promise<{ results: T[] }> {
          // reaper 用：grace_until>0 AND grace_until<=now AND status NOT IN(active,trialing)
          const now = args[0] as number
          const results = [...rows.values()].filter(
            (r) =>
              r.grace_until > 0 &&
              r.grace_until <= now &&
              r.status !== 'active' &&
              r.status !== 'trialing',
          )
          return { results: results as unknown as T[] }
        },
      }
      return stmt
    },
  } as unknown as D1Database

  return { db, rows }
}
