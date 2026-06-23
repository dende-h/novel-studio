import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteWork, getManifest, hashPart, pullWork, pushWork, sha256Hex } from './sync'

const TOKEN_KEY = 'sync-session-token'
const getToken = (jwt: string | null) => () => Promise.resolve(jwt)

function mockFetch(res: Partial<Response> & { jsonValue?: unknown }) {
  const f = vi.fn(() =>
    Promise.resolve({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: () => Promise.resolve(res.jsonValue ?? {}),
    } as Response),
  )
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getManifest', () => {
  it('成功時はエントリ配列を返し、Bearer＋セッショントークンを付ける', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-mine')
    const entries = [
      { workId: 'w1', updatedAt: 1, deleted: false, docHash: 'd', mediaHash: '', size: 1 },
    ]
    const f = mockFetch({ ok: true, jsonValue: { entries } })
    expect(await getManifest(getToken('jwt-1'))).toEqual(entries)
    expect(f).toHaveBeenCalledWith(
      '/api/sync/manifest',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-1',
          'X-Session-Token': 'tok-mine',
        }),
      }),
    )
  })

  it('JWT が無ければ fetch せず空配列', async () => {
    const f = mockFetch({ ok: true, jsonValue: { entries: [{ workId: 'w1' }] } })
    expect(await getManifest(getToken(null))).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('!ok なら空配列', async () => {
    mockFetch({ ok: false, status: 500 })
    expect(await getManifest(getToken('jwt-1'))).toEqual([])
  })

  it('entries 欠落なら空配列', async () => {
    mockFetch({ ok: true, jsonValue: {} })
    expect(await getManifest(getToken('jwt-1'))).toEqual([])
  })

  it('fetch 例外でも空配列（投げない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await getManifest(getToken('jwt-1'))).toEqual([])
  })
})

describe('pullWork', () => {
  it('成功時は PullResult を返す', async () => {
    const body = { doc: { id: 'w1' }, media: null, updatedAt: 100 }
    const f = mockFetch({ ok: true, jsonValue: body })
    expect(await pullWork(getToken('jwt-1'), 'w1')).toEqual(body)
    expect(f).toHaveBeenCalledWith(
      '/api/sync/work?id=w1',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('JWT が無ければ null（fetch しない）', async () => {
    const f = mockFetch({ ok: true })
    expect(await pullWork(getToken(null), 'w1')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('!ok なら null', async () => {
    mockFetch({ ok: false, status: 404 })
    expect(await pullWork(getToken('jwt-1'), 'w1')).toBeNull()
  })

  it('workId を URL エンコードする', async () => {
    const f = mockFetch({ ok: true, jsonValue: {} })
    await pullWork(getToken('jwt-1'), 'a/b c')
    expect(f).toHaveBeenCalledWith('/api/sync/work?id=a%2Fb%20c', expect.any(Object))
  })
})

describe('pushWork', () => {
  it('成功時は status=200＋PushResult を返し、PUT＋JSON ボディを送る', async () => {
    const payload = { updatedAt: 100, parts: ['doc'] as Array<'doc' | 'media'>, doc: { id: 'w1' } }
    const f = mockFetch({ ok: true, jsonValue: { docHash: 'd', mediaHash: '', size: 1 } })
    const res = await pushWork(getToken('jwt-1'), 'w1', payload)
    expect(res).toEqual({ status: 200, result: { docHash: 'd', mediaHash: '', size: 1 } })
    expect(f).toHaveBeenCalledWith(
      '/api/sync/work?id=w1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      }),
    )
  })

  it('JWT が無ければ status=0・result=null（fetch しない）', async () => {
    const f = mockFetch({ ok: true })
    expect(await pushWork(getToken(null), 'w1', { updatedAt: 1, parts: ['doc'], doc: {} })).toEqual(
      {
        status: 0,
        result: null,
      },
    )
    expect(f).not.toHaveBeenCalled()
  })

  it('!ok なら HTTP status を返す（409=superseded / 507=容量超過 の識別用）', async () => {
    mockFetch({ ok: false, status: 409 })
    expect(
      await pushWork(getToken('jwt-1'), 'w1', { updatedAt: 1, parts: ['doc'], doc: {} }),
    ).toEqual({ status: 409, result: null })
  })

  it('fetch 例外は status=0・result=null（投げない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(
      await pushWork(getToken('jwt-1'), 'w1', { updatedAt: 1, parts: ['doc'], doc: {} }),
    ).toEqual({ status: 0, result: null })
  })
})

describe('deleteWork', () => {
  it('成功時は true（DELETE を送る）', async () => {
    const f = mockFetch({ ok: true })
    expect(await deleteWork(getToken('jwt-1'), 'w1')).toBe(true)
    expect(f).toHaveBeenCalledWith(
      '/api/sync/work?id=w1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('JWT が無ければ false（fetch しない）', async () => {
    const f = mockFetch({ ok: true })
    expect(await deleteWork(getToken(null), 'w1')).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('!ok なら false', async () => {
    mockFetch({ ok: false, status: 500 })
    expect(await deleteWork(getToken('jwt-1'), 'w1')).toBe(false)
  })
})

describe('sha256Hex / hashPart', () => {
  it('空文字の SHA-256 は既知の値', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashPart はキー順に依存しない（canonicalize 経由で決定論）', async () => {
    const a = await hashPart({ a: 1, b: 2 })
    const b = await hashPart({ b: 2, a: 1 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('内容が違えばハッシュも違う', async () => {
    expect(await hashPart({ a: 1 })).not.toBe(await hashPart({ a: 2 }))
  })
})
