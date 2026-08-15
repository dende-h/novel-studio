// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 認証は可変の userId を返すようにモック（null なら未認証）。
// 会員（402）の判定は D1 フェイク側（members セット）で決まる。
const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async () =>
      authState.userId
        ? { isAuthenticated: true, toAuth: () => ({ userId: authState.userId }) }
        : { isAuthenticated: false },
  }),
}))

import { sha256Hex } from '../_lib/crypto'
import { onRequestGet as manifestGet } from './manifest'
import { fakeWorkRow, makeFakeR2, makeSyncDb, makeTestKeyB64 } from './sync-test-util'
import { onRequestDelete, onRequestGet, onRequestPatch, onRequestPut } from './work'

const KEY_B64 = makeTestKeyB64()

/** テスト用のコンテキスト一式（D1/R2 フェイク＋実物 crypto）。 */
function makeEnv(opts: { members?: string[] } = { members: ['user_1'] }) {
  const { db, works, rates } = makeSyncDb(opts)
  const { bucket, objects } = makeFakeR2()
  const env = {
    DB: db,
    MEDIA: bucket,
    ENCRYPTION_KEY: KEY_B64,
    CLERK_SECRET_KEY: 'sk',
    CLERK_PUBLISHABLE_KEY: 'pk',
  }
  return { env, works, rates, objects }
}

type Handler = PagesFunction<never>

function call(handler: Handler, env: unknown, request: Request): Promise<Response> {
  return handler({ request, env } as never) as Promise<Response>
}

const putReq = (
  workId: string,
  body: string,
  h: { base?: string; updatedAt?: number; trashedAt?: number } = {},
) =>
  new Request(`https://x/api/sync/work?id=${workId}`, {
    method: 'PUT',
    body,
    headers: {
      authorization: 'Bearer x',
      'x-base-hash': h.base ?? '',
      'x-updated-at': String(h.updatedAt ?? 100),
      'x-trashed-at': String(h.trashedAt ?? 0),
    },
  })

const getReq = (workId: string) =>
  new Request(`https://x/api/sync/work?id=${workId}`, { headers: { authorization: 'Bearer x' } })

const patchReq = (workId: string, body: { trashedAt: number; updatedAt: number }) =>
  new Request(`https://x/api/sync/work?id=${workId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { authorization: 'Bearer x' },
  })

const deleteReq = (workId: string, at: number) =>
  new Request(`https://x/api/sync/work?id=${workId}&at=${at}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer x' },
  })

const WORK = JSON.stringify({ id: 'w1', title: '物語', episodes: [] })

beforeEach(() => {
  authState.userId = 'user_1'
})

describe('認証ゲート', () => {
  it('未認証は 401', async () => {
    authState.userId = null
    const { env } = makeEnv()
    const res = await call(onRequestPut, env, putReq('w1', WORK))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('非会員は 402', async () => {
    const { env } = makeEnv({ members: [] })
    const res = await call(onRequestPut, env, putReq('w1', WORK))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'subscription_required' })
  })

  it('manifest も同じゲート（401/402）', async () => {
    const none = makeEnv({ members: [] })
    const req = new Request('https://x/api/sync/manifest', {
      headers: { authorization: 'Bearer x' },
    })
    expect((await call(manifestGet, none.env, req)).status).toBe(402)
    authState.userId = null
    expect((await call(manifestGet, none.env, req)).status).toBe(401)
  })
})

describe('レート制限（変更系のみ 60 req/min）', () => {
  it('窓内 60 件で PUT/PATCH/DELETE は 429', async () => {
    const { env, rates } = makeEnv()
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000
    rates.set('user_1', { user_id: 'user_1', window_start: windowStart, count: 60 })
    expect((await call(onRequestPut, env, putReq('w1', WORK))).status).toBe(429)
    expect(
      (await call(onRequestPatch, env, patchReq('w1', { trashedAt: 1, updatedAt: 1 }))).status,
    ).toBe(429)
    expect((await call(onRequestDelete, env, deleteReq('w1', 1))).status).toBe(429)
    expect(await (await call(onRequestPut, env, putReq('w1', WORK))).json()).toEqual({
      error: 'rate_limited',
    })
  })

  it('GET はレート制限の対象外', async () => {
    const { env, rates } = makeEnv()
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000
    rates.set('user_1', { user_id: 'user_1', window_start: windowStart, count: 60 })
    // 行なしの 404 になる＝429 で弾かれていない。
    expect((await call(onRequestGet, env, getReq('w1'))).status).toBe(404)
  })
})

describe('サイズ上限', () => {
  it('平文 25MB 超は 413', async () => {
    const { env } = makeEnv()
    const big = 'a'.repeat(25 * 1024 * 1024 + 1)
    const res = await call(onRequestPut, env, putReq('w1', big))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
  })

  it('ユーザー合計 1GB 超は 507（live 行のみ・当該 work の旧 size は除外）', async () => {
    const { env, works } = makeEnv()
    const GB = 1024 * 1024 * 1024
    // 別 work が既に 1GB 弱を占有 → 新規 push が上限を跨ぐ。
    works.set('user_1:big', fakeWorkRow({ work_id: 'big', doc_size: GB - 10 }))
    const res = await call(onRequestPut, env, putReq('w1', WORK))
    expect(res.status).toBe(507)
    expect(await res.json()).toEqual({ error: 'quota_exceeded' })

    // 当該 work 自身の旧 size は除外される＝同サイズの上書きは通る。
    works.clear()
    works.set(
      'user_1:w1',
      fakeWorkRow({ work_id: 'w1', doc_size: GB - 10, doc_hash: await sha256Hex(WORK) }),
    )
    const over = await call(onRequestPut, env, putReq('w1', WORK, { base: await sha256Hex(WORK) }))
    expect(over.status).toBe(200)

    // tombstone（deleted=1）は合計に入らない。
    works.clear()
    works.set('user_1:dead', fakeWorkRow({ work_id: 'dead', doc_size: GB, deleted: 1 }))
    expect((await call(onRequestPut, env, putReq('w1', WORK))).status).toBe(200)
  })
})

describe('PUT の CAS 規則', () => {
  it("行なし: base='' のみ受理、それ以外は 409", async () => {
    const { env, works } = makeEnv()
    expect((await call(onRequestPut, env, putReq('w1', WORK, { base: '' }))).status).toBe(200)
    expect(works.get('user_1:w1')).toBeDefined()

    const res = await call(onRequestPut, env, putReq('w2', WORK, { base: 'stale' }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; meta: { deleted: number } }
    expect(body.error).toBe('conflict')
    expect(body.meta.deleted).toBe(1)
  })

  it('live 行: base が doc_hash と一致するときのみ受理', async () => {
    const { env, works } = makeEnv()
    const hash = await sha256Hex(WORK)
    works.set('user_1:w1', fakeWorkRow({ doc_hash: hash, updated_at: 100 }))

    const ng = await call(onRequestPut, env, putReq('w1', '{"v":2}', { base: 'other' }))
    expect(ng.status).toBe(409)
    const body = (await ng.json()) as { error: string; meta: { docHash: string } }
    expect(body.meta.docHash).toBe(hash)

    const ok = await call(
      onRequestPut,
      env,
      putReq('w1', '{"v":2}', { base: hash, updatedAt: 200 }),
    )
    expect(ok.status).toBe(200)
    expect(works.get('user_1:w1')?.updated_at).toBe(200)
  })

  it('tombstone 行: updated_at が前進するときのみ受理（復活＝編集勝ち）', async () => {
    const { env, works } = makeEnv()
    works.set('user_1:w1', fakeWorkRow({ deleted: 1, updated_at: 500 }))

    const stale = await call(onRequestPut, env, putReq('w1', WORK, { updatedAt: 400 }))
    expect(stale.status).toBe(409)
    // 同時刻も棄却（> のみ受理）。
    expect((await call(onRequestPut, env, putReq('w1', WORK, { updatedAt: 500 }))).status).toBe(409)

    const revive = await call(onRequestPut, env, putReq('w1', WORK, { updatedAt: 600 }))
    expect(revive.status).toBe(200)
    expect(works.get('user_1:w1')).toMatchObject({ deleted: 0, updated_at: 600 })
  })
})

describe('PUT → GET round-trip', () => {
  it('復号した本文とメタヘッダが一致する', async () => {
    const { env, works, objects } = makeEnv()
    const hash = await sha256Hex(WORK)
    const put = await call(onRequestPut, env, putReq('w1', WORK, { updatedAt: 123, trashedAt: 0 }))
    expect(put.status).toBe(200)
    const putBody = (await put.json()) as { docHash: string; syncedAt: number }
    expect(putBody.docHash).toBe(hash)
    expect(putBody.syncedAt).toBeGreaterThan(0)

    // R2 には暗号化 blob が置かれる（平文そのものではない）。
    const blob = objects.get('user_1/works/w1/doc')
    expect(blob).toBeDefined()
    expect(new TextDecoder().decode(blob)).not.toContain('物語')
    // D1 行の形（媒体列は固定値）。
    expect(works.get('user_1:w1')).toMatchObject({
      doc_key: 'user_1/works/w1/doc',
      doc_hash: hash,
      doc_size: new TextEncoder().encode(WORK).byteLength,
      media_key: null,
      media_hash: '',
      media_size: 0,
    })

    const res = await call(onRequestGet, env, getReq('w1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('x-doc-hash')).toBe(hash)
    expect(res.headers.get('x-updated-at')).toBe('123')
    expect(res.headers.get('x-trashed-at')).toBe('0')
    expect(await res.text()).toBe(WORK)
  })

  it('行なし・tombstone・R2 欠落は 404', async () => {
    const { env, works } = makeEnv()
    expect((await call(onRequestGet, env, getReq('nope'))).status).toBe(404)

    works.set('user_1:dead', fakeWorkRow({ work_id: 'dead', deleted: 1 }))
    expect((await call(onRequestGet, env, getReq('dead'))).status).toBe(404)

    // 行はあるが R2 に blob が無い。
    works.set('user_1:w1', fakeWorkRow())
    expect((await call(onRequestGet, env, getReq('w1'))).status).toBe(404)
  })
})

describe('PATCH（ゴミ箱伝播・LWW）', () => {
  it('行なし・tombstone は 404', async () => {
    const { env, works } = makeEnv()
    expect(
      (await call(onRequestPatch, env, patchReq('nope', { trashedAt: 1, updatedAt: 1 }))).status,
    ).toBe(404)
    works.set('user_1:dead', fakeWorkRow({ work_id: 'dead', deleted: 1 }))
    expect(
      (await call(onRequestPatch, env, patchReq('dead', { trashedAt: 1, updatedAt: 999 }))).status,
    ).toBe(404)
  })

  it('古い patch は 409 で棄却し、メタを返す（LWW）', async () => {
    const { env, works } = makeEnv()
    works.set('user_1:w1', fakeWorkRow({ updated_at: 500, trashed_at: 0 }))
    const res = await call(onRequestPatch, env, patchReq('w1', { trashedAt: 300, updatedAt: 400 }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; meta: { updatedAt: number } }
    expect(body.error).toBe('conflict')
    expect(body.meta.updatedAt).toBe(500)
    // 行は変わらない。
    expect(works.get('user_1:w1')).toMatchObject({ trashed_at: 0, updated_at: 500 })
  })

  it('新しい patch は trashed_at/updated_at を反映しメタを返す（blob 不変）', async () => {
    const { env, works, objects } = makeEnv()
    objects.set('user_1/works/w1/doc', new Uint8Array([1, 2, 3]))
    works.set('user_1:w1', fakeWorkRow({ updated_at: 500, trashed_at: 0 }))
    const res = await call(onRequestPatch, env, patchReq('w1', { trashedAt: 600, updatedAt: 600 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { meta: { trashedAt: number; updatedAt: number } }
    expect(body.meta).toMatchObject({ workId: 'w1', trashedAt: 600, updatedAt: 600 })
    expect(works.get('user_1:w1')).toMatchObject({ trashed_at: 600, updated_at: 600 })
    // blob はそのまま。
    expect(objects.get('user_1/works/w1/doc')).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('PUT の CAS は条件付き書き込みで確定する（読み→書きの隙間に強い）', () => {
  it('SELECT 通過後に別端末の PUT が滑り込むと 409（後勝ちの黙った上書きにならない）', async () => {
    const { env, works } = makeEnv()
    works.set('user_1:w1', fakeWorkRow({ doc_hash: 'h1', updated_at: 100 }))

    // 条件付き UPDATE（CAS）が prepare された瞬間に行を書き換え、
    // 「事前 SELECT は h1 を見たが、書き込み時には別端末が h2 に進めていた」を再現する。
    const db = env.DB as unknown as { prepare: (sql: string) => unknown }
    const origPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      if (sql.includes('deleted = 0 AND doc_hash = ?')) {
        const r = works.get('user_1:w1')
        if (r) works.set('user_1:w1', { ...r, doc_hash: 'h2', updated_at: 900 })
      }
      return origPrepare(sql)
    }

    const res = await call(onRequestPut, env, putReq('w1', WORK, { base: 'h1', updatedAt: 200 }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { meta: { docHash: string } }
    expect(body.meta.docHash).toBe('h2') // 現在のサーバ側メタを返す
    expect(works.get('user_1:w1')).toMatchObject({ doc_hash: 'h2', updated_at: 900 }) // 上書きされていない
  })
})

describe('DELETE（purge＝トゥームストーン化）', () => {
  it('行なしは冪等に 200', async () => {
    const { env } = makeEnv()
    const res = await call(onRequestDelete, env, deleteReq('nope', 100))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('古い purge（at < 行の updated_at）は 409 で棄却＝新しい編集を削除で消さない', async () => {
    const { env, works, objects } = makeEnv()
    objects.set('user_1/works/w1/doc', new Uint8Array([1]))
    works.set('user_1:w1', fakeWorkRow({ updated_at: 500 }))

    const res = await call(onRequestDelete, env, deleteReq('w1', 300))
    expect(res.status).toBe(409)
    // 行も blob も無傷（編集勝ち・クライアントは再 reconcile で pull し直す）。
    expect(works.get('user_1:w1')).toMatchObject({ deleted: 0, updated_at: 500 })
    expect(objects.has('user_1/works/w1/doc')).toBe(true)
  })

  it('blob を消し、tombstone 行は残る（updated_at = at）。二重 DELETE は冪等に 200', async () => {
    const { env, works, objects } = makeEnv()
    objects.set('user_1/works/w1/doc', new Uint8Array([1]))
    works.set('user_1:w1', fakeWorkRow({ updated_at: 500 }))

    const res = await call(onRequestDelete, env, deleteReq('w1', 700))
    expect(await res.json()).toEqual({ ok: true })
    expect(objects.has('user_1/works/w1/doc')).toBe(false)
    expect(works.get('user_1:w1')).toMatchObject({ deleted: 1, updated_at: 700 })

    // 二重 DELETE（tombstone 済み）は時計を巻き戻さず冪等に 200。
    const again = await call(onRequestDelete, env, deleteReq('w1', 100))
    expect(again.status).toBe(200)
    expect(works.get('user_1:w1')).toMatchObject({ deleted: 1, updated_at: 700 })
  })
})

describe('GET /api/sync/manifest', () => {
  it('全行（active/trashed/tombstone）を RemoteWorkMeta の形で workId 昇順に返す', async () => {
    const { env, works } = makeEnv()
    works.set(
      'user_1:b',
      fakeWorkRow({ work_id: 'b', trashed_at: 50, updated_at: 60, synced_at: 61 }),
    )
    works.set('user_1:a', fakeWorkRow({ work_id: 'a', doc_hash: 'ha', doc_size: 7 }))
    works.set('user_1:c', fakeWorkRow({ work_id: 'c', deleted: 1 }))
    // 他ユーザーの行は混ざらない。
    works.set('user_2:z', fakeWorkRow({ user_id: 'user_2', work_id: 'z' }))

    const res = await call(
      manifestGet,
      env,
      new Request('https://x/api/sync/manifest', { headers: { authorization: 'Bearer x' } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { works: Array<Record<string, unknown>> }
    expect(body.works.map((w) => w.workId)).toEqual(['a', 'b', 'c'])
    expect(body.works[0]).toEqual({
      workId: 'a',
      updatedAt: 100,
      trashedAt: 0,
      deleted: 0,
      docHash: 'ha',
      docSize: 7,
      syncedAt: 100,
    })
    expect(body.works[1]).toMatchObject({ trashedAt: 50, updatedAt: 60, syncedAt: 61 })
    expect(body.works[2]).toMatchObject({ deleted: 1 })
  })
})
