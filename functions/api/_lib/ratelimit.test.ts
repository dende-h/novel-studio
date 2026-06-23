// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { checkRateLimit, RATE_LIMIT } from './ratelimit'

/** rate_limits テーブルだけを扱う最小の D1 フェイク。 */
function makeDb(): D1Database {
  const store = new Map<string, { window_start: number; count: number }>()
  return {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first() {
          const [userId] = args as [string]
          return store.get(userId) ?? null
        },
        async run() {
          if (sql.includes('INSERT INTO rate_limits')) {
            const [userId, windowStart] = args as [string, number]
            store.set(userId, { window_start: windowStart, count: 1 })
          } else if (sql.includes('count = count + 1')) {
            const [userId] = args as [string]
            const cur = store.get(userId)
            if (cur) cur.count += 1
          }
          return { success: true }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

describe('checkRateLimit', () => {
  it('上限までは許可し、超えると拒否する', async () => {
    const db = makeDb()
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect(await checkRateLimit(db, 'user_1', now)).toBe(true)
    }
    expect(await checkRateLimit(db, 'user_1', now)).toBe(false)
  })

  it('窓が変わるとカウンタがリセットされる', async () => {
    const db = makeDb()
    const t0 = 0
    for (let i = 0; i < RATE_LIMIT; i++) {
      await checkRateLimit(db, 'user_1', t0)
    }
    expect(await checkRateLimit(db, 'user_1', t0)).toBe(false)
    // 次の 1 分窓
    expect(await checkRateLimit(db, 'user_1', t0 + 60_000)).toBe(true)
  })

  it('ユーザーごとに独立して数える', async () => {
    const db = makeDb()
    const now = 5_000
    for (let i = 0; i < RATE_LIMIT; i++) {
      await checkRateLimit(db, 'a', now)
    }
    expect(await checkRateLimit(db, 'a', now)).toBe(false)
    expect(await checkRateLimit(db, 'b', now)).toBe(true)
  })
})
