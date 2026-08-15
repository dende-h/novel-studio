// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { makeSyncDb } from '../sync/sync-test-util'
import { checkRateLimit } from './rate-limit'

// 分窓の基準時刻（窓の先頭ちょうど）。
const T0 = 1_700_000_040_000 - (1_700_000_040_000 % 60_000)

describe('checkRateLimit', () => {
  it('limit 件までは true、超えたら false', async () => {
    const { db } = makeSyncDb()
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit(db, 'u1', T0 + i, 3)).toBe(true)
    }
    expect(await checkRateLimit(db, 'u1', T0 + 10, 3)).toBe(false)
  })

  it('分窓が変わるとカウントがリセットされる', async () => {
    const { db } = makeSyncDb()
    expect(await checkRateLimit(db, 'u1', T0, 1)).toBe(true)
    expect(await checkRateLimit(db, 'u1', T0 + 59_999, 1)).toBe(false)
    // 次の分窓では再び通る。
    expect(await checkRateLimit(db, 'u1', T0 + 60_000, 1)).toBe(true)
  })

  it('ユーザーごとに独立してカウントする', async () => {
    const { db } = makeSyncDb()
    expect(await checkRateLimit(db, 'u1', T0, 1)).toBe(true)
    expect(await checkRateLimit(db, 'u1', T0 + 1, 1)).toBe(false)
    expect(await checkRateLimit(db, 'u2', T0 + 2, 1)).toBe(true)
  })

  it('既定 limit は 60', async () => {
    const { db, rates } = makeSyncDb()
    rates.set('u1', { user_id: 'u1', window_start: T0, count: 59 })
    expect(await checkRateLimit(db, 'u1', T0 + 1)).toBe(true)
    expect(await checkRateLimit(db, 'u1', T0 + 2)).toBe(false)
  })

  it('window_start がずれた既存行はリセットして数え直す', async () => {
    const { db, rates } = makeSyncDb()
    rates.set('u1', { user_id: 'u1', window_start: T0 - 60_000, count: 999 })
    expect(await checkRateLimit(db, 'u1', T0, 3)).toBe(true)
    expect(rates.get('u1')).toMatchObject({ window_start: T0, count: 1 })
  })
})
