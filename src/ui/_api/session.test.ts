import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSession, claimSession, clearSessionToken } from './session'

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

describe('claimSession', () => {
  it('成功時はサーバ発行トークンを localStorage に保存し true を返す', async () => {
    const f = mockFetch({ ok: true, jsonValue: { sessionToken: 'tok-new' } })
    const ok = await claimSession(getToken('jwt-1'))
    expect(ok).toBe(true)
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-new')
    // Bearer JWT を付けて claim を叩く。
    expect(f).toHaveBeenCalledWith(
      '/api/session/claim',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-1' }),
      }),
    )
  })

  it('JWT が取得できなければ fetch せず false（トークンは書かない）', async () => {
    const f = mockFetch({ ok: true, jsonValue: { sessionToken: 'tok-new' } })
    const ok = await claimSession(getToken(null))
    expect(ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('レスポンスが !ok なら false（トークンは書かない）', async () => {
    mockFetch({ ok: false, status: 500, jsonValue: { sessionToken: 'tok-new' } })
    const ok = await claimSession(getToken('jwt-1'))
    expect(ok).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('sessionToken 欠落なら false（トークンは書かない）', async () => {
    mockFetch({ ok: true, jsonValue: {} })
    const ok = await claimSession(getToken('jwt-1'))
    expect(ok).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('fetch 例外でも false（投げない・トークンは書かない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    const ok = await claimSession(getToken('jwt-1'))
    expect(ok).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})

describe('checkSession', () => {
  it('409 は superseded（別端末に奪われた）', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-mine')
    const f = mockFetch({ ok: false, status: 409 })
    const r = await checkSession(getToken('jwt-1'))
    expect(r).toBe('superseded')
    // 保存済みトークンを X-Session-Token で提示する。
    expect(f).toHaveBeenCalledWith(
      '/api/session/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-1',
          'X-Session-Token': 'tok-mine',
        }),
      }),
    )
  })

  it('200 は active', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-mine')
    mockFetch({ ok: true, status: 200 })
    expect(await checkSession(getToken('jwt-1'))).toBe('active')
  })

  it('409 以外のエラーは unknown（過渡的失敗で停止させない）', async () => {
    mockFetch({ ok: false, status: 500 })
    expect(await checkSession(getToken('jwt-1'))).toBe('unknown')
  })

  it('JWT が取得できなければ unknown（fetch しない）', async () => {
    const f = mockFetch({ ok: true })
    expect(await checkSession(getToken(null))).toBe('unknown')
    expect(f).not.toHaveBeenCalled()
  })

  it('fetch 例外は unknown（投げない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await checkSession(getToken('jwt-1'))).toBe('unknown')
  })

  it('トークン未保存なら空文字を提示する', async () => {
    const f = mockFetch({ ok: true, status: 200 })
    await checkSession(getToken('jwt-1'))
    expect(f).toHaveBeenCalledWith(
      '/api/session/status',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Session-Token': '' }),
      }),
    )
  })
})

describe('clearSessionToken', () => {
  it('保存済みトークンを破棄する', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-mine')
    clearSessionToken()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('未保存でも例外を投げない', () => {
    expect(() => clearSessionToken()).not.toThrow()
  })
})
