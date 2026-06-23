// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 検証・セッション照合・レート制限はモック（暗号化と保存ロジックを実物で通す）。
vi.mock('../_lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/auth')>()
  return { ...actual, verifyUserId: vi.fn(async () => 'user_1') }
})
vi.mock('../_lib/session-check', () => ({ isCurrentSession: vi.fn(async () => true) }))
vi.mock('../_lib/ratelimit', () => ({ checkRateLimit: vi.fn(async () => true), RATE_LIMIT: 60 }))

import { onRequestDelete, onRequestGet, onRequestPut } from './work'

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

interface Row {
  user_id: string
  work_id: string
  updated_at: number
  deleted: number
  doc_key: string
  doc_hash: string
  doc_size: number
  media_key: string | null
  media_hash: string
  media_size: number
  synced_at: number
}

function makeWorksDb(): D1Database {
  const rows = new Map<string, Row>()
  const k = (u: string, w: string) => `${u}::${w}`
  return {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first() {
          if (sql.includes('COALESCE(SUM')) {
            const [userId] = args as [string]
            let total = 0
            for (const r of rows.values()) {
              if (r.user_id === userId && r.deleted === 0) total += r.doc_size + r.media_size
            }
            return { total }
          }
          const [userId, workId] = args as [string, string]
          return rows.get(k(userId, workId)) ?? null
        },
        async run() {
          if (sql.includes('VALUES (?, ?, ?, 0,')) {
            const [
              user_id,
              work_id,
              updated_at,
              doc_key,
              doc_hash,
              doc_size,
              media_key,
              media_hash,
              media_size,
              synced_at,
            ] = args as [
              string,
              string,
              number,
              string,
              string,
              number,
              string | null,
              string,
              number,
              number,
            ]
            rows.set(k(user_id, work_id), {
              user_id,
              work_id,
              updated_at,
              deleted: 0,
              doc_key,
              doc_hash,
              doc_size,
              media_key,
              media_hash,
              media_size,
              synced_at,
            })
          } else if (sql.includes('VALUES (?, ?, ?, 1,')) {
            const [user_id, work_id, updated_at, doc_key, synced_at] = args as [
              string,
              string,
              number,
              string,
              number,
            ]
            const ex = rows.get(k(user_id, work_id))
            if (ex) {
              Object.assign(ex, {
                deleted: 1,
                doc_hash: '',
                media_hash: '',
                doc_size: 0,
                media_size: 0,
                media_key: null,
                updated_at,
                synced_at,
              })
            } else {
              rows.set(k(user_id, work_id), {
                user_id,
                work_id,
                updated_at,
                deleted: 1,
                doc_key,
                doc_hash: '',
                doc_size: 0,
                media_key: null,
                media_hash: '',
                media_size: 0,
                synced_at,
              })
            }
          }
          return { success: true }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

function makeR2(): R2Bucket {
  const store = new Map<string, Uint8Array>()
  return {
    async put(key: string, value: Uint8Array) {
      store.set(key, value)
    },
    async get(key: string) {
      const v = store.get(key)
      if (!v) return null
      return {
        async arrayBuffer() {
          return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)
        },
      }
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket
}

let env: {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
}

beforeEach(() => {
  env = {
    DB: makeWorksDb(),
    MEDIA: makeR2(),
    ENCRYPTION_KEY: KEY_B64,
    CLERK_SECRET_KEY: 'x',
    CLERK_PUBLISHABLE_KEY: 'x',
  }
})

type Ctx = Parameters<typeof onRequestPut>[0]
const ctx = (request: Request): Ctx => ({ request, env }) as unknown as Ctx

const putReq = (body: unknown) =>
  new Request('https://x/api/sync/work?id=w1', {
    method: 'PUT',
    headers: { 'X-Session-Token': 't', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const getReq = () =>
  new Request('https://x/api/sync/work?id=w1', { headers: { 'X-Session-Token': 't' } })
const delReq = () =>
  new Request('https://x/api/sync/work?id=w1', {
    method: 'DELETE',
    headers: { 'X-Session-Token': 't' },
  })

const DOC = { id: 'w1', title: '物語', episodes: [] }
const MEDIA = {
  coverImage: 'data:image/png;base64,AAAA',
  thumbnails: { g1: 'data:image/jpeg;base64,BBBB' },
}

describe('PUT → GET（暗号化を通したラウンドトリップ）', () => {
  it('doc と media を push して pull すると元のオブジェクトに戻る', async () => {
    const put = await onRequestPut(
      ctx(putReq({ updatedAt: 100, parts: ['doc', 'media'], doc: DOC, media: MEDIA })),
    )
    expect(put.status).toBe(200)
    const putBody = (await put.json()) as { docHash: string; mediaHash: string; size: number }
    expect(putBody.docHash).toMatch(/^[0-9a-f]{64}$/)
    expect(putBody.mediaHash).toMatch(/^[0-9a-f]{64}$/)
    expect(putBody.size).toBeGreaterThan(0)

    const get = await onRequestGet(ctx(getReq()))
    expect(get.status).toBe(200)
    const getBody = (await get.json()) as { doc: unknown; media: unknown; updatedAt: number }
    expect(getBody.doc).toEqual(DOC)
    expect(getBody.media).toEqual(MEDIA)
    expect(getBody.updatedAt).toBe(100)
  })

  it('doc だけの再 push では media が保持される（変わった側だけ更新）', async () => {
    await onRequestPut(
      ctx(putReq({ updatedAt: 100, parts: ['doc', 'media'], doc: DOC, media: MEDIA })),
    )
    const newDoc = { ...DOC, title: '改題' }
    const put2 = await onRequestPut(ctx(putReq({ updatedAt: 200, parts: ['doc'], doc: newDoc })))
    expect(put2.status).toBe(200)

    const getBody = (await (await onRequestGet(ctx(getReq()))).json()) as {
      doc: unknown
      media: unknown
    }
    expect(getBody.doc).toEqual(newDoc)
    expect(getBody.media).toEqual(MEDIA)
  })

  it('media に null を push すると media が消える', async () => {
    await onRequestPut(
      ctx(putReq({ updatedAt: 100, parts: ['doc', 'media'], doc: DOC, media: MEDIA })),
    )
    await onRequestPut(ctx(putReq({ updatedAt: 200, parts: ['media'], media: null })))
    const getBody = (await (await onRequestGet(ctx(getReq()))).json()) as { media: unknown }
    expect(getBody.media).toBeNull()
  })
})

describe('バリデーションと削除', () => {
  it('新規 Work で doc を伴わない push は 400', async () => {
    const res = await onRequestPut(ctx(putReq({ updatedAt: 100, parts: ['media'], media: MEDIA })))
    expect(res.status).toBe(400)
  })

  it('DELETE 後の GET は 404（トゥームストーン化）', async () => {
    await onRequestPut(ctx(putReq({ updatedAt: 100, parts: ['doc'], doc: DOC })))
    const del = await onRequestDelete(ctx(delReq()))
    expect(del.status).toBe(200)
    const get = await onRequestGet(ctx(getReq()))
    expect(get.status).toBe(404)
  })
})
