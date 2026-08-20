// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from './hit'

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

interface VisitorRow {
  date: string
  site: string
  visitor: string
  first_seen: number
  hits: number
  landing_path: string
  referer_host: string
  country: string
  device: string
}

/** visitor_days と rate_limits だけを Map で持つ D1 フェイク（sync-test-util と同じ流儀）。 */
function makeDb() {
  const rows = new Map<string, VisitorRow>()
  const rates = new Map<string, { window_start: number; count: number }>()

  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM rate_limits')) {
            return (rates.get(args[0] as string) ?? null) as T | null
          }
          throw new Error(`想定外の SELECT: ${sql}`)
        },
        async run() {
          if (sql.includes('INTO rate_limits')) {
            rates.set(args[0] as string, {
              window_start: args[1] as number,
              count: args[2] as number,
            })
            return {}
          }
          if (sql.includes('INTO visitor_days')) {
            const [date, site, visitor, firstSeen, landing, referer, country, device] = args as [
              string,
              string,
              string,
              number,
              string,
              string,
              string,
              string,
            ]
            const key = `${date}:${site}:${visitor}`
            const cur = rows.get(key)
            // ON CONFLICT DO UPDATE SET hits = hits + 1（着地情報は最初のまま）。
            if (cur) cur.hits += 1
            else
              rows.set(key, {
                date,
                site,
                visitor,
                first_seen: firstSeen,
                hits: 1,
                landing_path: landing,
                referer_host: referer,
                country,
                device,
              })
            return {}
          }
          throw new Error(`想定外の書き込み: ${sql}`)
        },
      }
      return stmt
    },
  } as unknown as D1Database

  return { db, rows, rates }
}

function hit(
  over: { origin?: string; ua?: string; ip?: string; country?: string; body?: string } = {},
) {
  const headers: Record<string, string> = {
    origin: over.origin ?? 'https://cotonoha-leaf.org',
    'user-agent': over.ua ?? CHROME_WIN,
    'cf-ipcountry': over.country ?? 'JP',
  }
  const ip = 'ip' in over ? over.ip : '203.0.113.9'
  if (ip) headers['cf-connecting-ip'] = ip
  return new Request('https://cotonoha-leaf.org/api/hit', {
    method: 'POST',
    headers,
    body: over.body ?? JSON.stringify({ p: '/lp/', r: 'https://t.co/abc' }),
  })
}

function call(env: unknown, request: Request): Promise<Response> {
  return (onRequestPost as PagesFunction<never>)({ request, env } as never) as Promise<Response>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T03:00:00Z')) // JST 12:00 → 2026-08-20
})

afterEach(() => {
  vi.useRealTimers()
})

describe('記録', () => {
  it('本番サイトのアクセスを 1 行残す', async () => {
    const { db, rows } = makeDb()
    const res = await call({ DB: db }, hit())

    expect(res.status).toBe(204)
    const row = [...rows.values()][0]
    expect(row).toMatchObject({
      date: '2026-08-20',
      site: 'leaf',
      hits: 1,
      landing_path: '/lp/',
      referer_host: 't.co',
      country: 'JP',
      device: 'desktop',
    })
    expect(row.visitor).toMatch(/^[0-9a-f]{16}$/)
  })

  it('grove のオリジンからも受ける（別デプロイから越境で届く）', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit({ origin: 'https://grove.cotonoha-leaf.org' }))
    expect([...rows.values()][0]?.site).toBe('grove')
  })

  it('同じ相手の 2 回目は行を増やさず hits だけ進め、着地情報は最初のまま', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit())
    await call(
      { DB: db },
      hit({ body: JSON.stringify({ p: '/works/x', r: 'https://cotonoha-leaf.org/lp/' }) }),
    )

    expect(rows.size).toBe(1)
    expect([...rows.values()][0]).toMatchObject({
      hits: 2,
      landing_path: '/lp/',
      referer_host: 't.co',
    })
  })

  it('ブラウザのバージョンが上がっただけでは別人にしない', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit())
    await call({ DB: db }, hit({ ua: CHROME_WIN.replace('140.0.0.0', '141.0.0.0') }))
    expect(rows.size).toBe(1)
  })

  it('IP が違えば別の人として数える', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit())
    await call({ DB: db }, hit({ ip: '198.51.100.4', ua: SAFARI_IOS }))
    expect(rows.size).toBe(2)
    expect([...rows.values()].map((r) => r.device).sort()).toEqual(['desktop', 'mobile'])
  })

  it('日付が変われば別の行（符号も変わる）', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit())
    vi.setSystemTime(new Date('2026-08-21T03:00:00Z'))
    await call({ DB: db }, hit())

    expect(rows.size).toBe(2)
    const [a, b] = [...rows.values()]
    expect(a.visitor).not.toBe(b.visitor)
    expect([a.date, b.date]).toEqual(['2026-08-20', '2026-08-21'])
  })

  it('サイトごとに符号が分かれる（サイトをまたいで同一人物を結び付けない）', async () => {
    const { db, rows } = makeDb()
    await call({ DB: db }, hit())
    await call({ DB: db }, hit({ origin: 'https://cotonoha-grove.org' }))
    const visitors = [...rows.values()].map((r) => r.visitor)
    expect(new Set(visitors).size).toBe(2)
  })
})

describe('記録しない', () => {
  const skipped = async (req: Request, env: Record<string, unknown> = {}) => {
    const { db, rows } = makeDb()
    const res = await call({ DB: db, ...env }, req)
    expect(res.status).toBe(204)
    expect(rows.size).toBe(0)
  }

  it('stg・プレビュー（*.pages.dev）＝開発者自身', () =>
    skipped(hit({ origin: 'https://novel-studio-b2m.pages.dev' })))

  it('ローカル開発', () => skipped(hit({ origin: 'http://localhost:5173' })))

  it('見知らぬオリジン', () => skipped(hit({ origin: 'https://evil.example' })))

  it('Origin が無い（ブラウザ以外からの直叩き）', () => skipped(hit({ origin: '' })))

  it('ボット', () => skipped(hit({ ua: 'Googlebot/2.1' })))

  it('User-Agent が空', () => skipped(hit({ ua: '' })))

  it('クライアント IP が取れない', () => skipped(hit({ ip: '' })))

  it('本文が JSON でない', () => skipped(hit({ body: 'not json' })))

  it('DB バインディングが無い', async () => {
    const res = await call({}, hit())
    expect(res.status).toBe(204)
  })
})

describe('レート制限', () => {
  it('1 分あたりの上限を超えたら記録を止める', async () => {
    const { db, rows } = makeDb()
    for (let i = 0; i < 65; i++) await call({ DB: db }, hit())
    expect(rows.size).toBe(1)
    expect([...rows.values()][0].hits).toBe(60)
  })

  it('分が変われば再び受け付ける', async () => {
    const { db, rows } = makeDb()
    for (let i = 0; i < 65; i++) await call({ DB: db }, hit())
    vi.setSystemTime(new Date('2026-08-20T03:01:00Z'))
    await call({ DB: db }, hit())
    expect([...rows.values()][0].hits).toBe(61)
  })
})
