import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Work } from '@/core/schema'

/**
 * platform への直接投稿クライアント。
 * 失敗時にユーザーへ何を見せるかまで含めて固定する
 * （通信断・未サインイン・作者未登録は、それぞれ出す文言と導線が違う）。
 */

const ORIGIN = 'https://platform.example'
const work: Work = { id: 'w1', title: '作品', episodes: [] }

async function loadModule() {
  vi.stubEnv('VITE_PLATFORM_ORIGIN', ORIGIN)
  vi.resetModules()
  return import('./publish')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('publishWorkToPlatform', () => {
  it('Clerk の JWT を Bearer で載せ、schemaVersion 付きで送る', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, created: true, manageUrl: '/dashboard/works/x/episodes' }), {
        status: 201,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishWorkToPlatform(async () => 'jwt-token', work)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/import/kotonoha`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token')
    expect(JSON.parse(init.body as string)).toEqual({ schemaVersion: 1, work })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBe(true)
      // 確認先は platform の絶対URLにして、そのまま開けるようにする
      expect(result.manageUrl).toBe(`${ORIGIN}/dashboard/works/x/episodes`)
    }
  })

  it('未サインインなら fetch せずに案内を返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishWorkToPlatform(async () => null, work)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: '公開するにはサインインが必要です' })
  })

  it('作者未登録なら登録先の絶対URLを添えて返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'not-author', message: '作者登録が必要です', registerUrl: '/dashboard' }), {
          status: 403,
        }),
      ),
    )

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('作者登録が必要です')
      expect(result.registerUrl).toBe(`${ORIGIN}/dashboard`)
    }
  })

  it('通信に失敗したら接続エラーの文言を返す', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result).toEqual({ ok: false, message: '公開先に接続できませんでした。通信環境を確認してください' })
  })

  it('本文が読めないエラー応答でもステータスから文言を決める', async () => {
    const { publishWorkToPlatform } = await loadModule()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 413 })))

    const result = await publishWorkToPlatform(async () => 'jwt', work)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('作品が大きすぎます。話を分けて送ってください')
    }
  })

  it('公開先が未設定なら投稿を試みない', async () => {
    vi.stubEnv('VITE_PLATFORM_ORIGIN', '')
    vi.resetModules()
    const { publishWorkToPlatform, isPublishAvailable } = await import('./publish')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(isPublishAvailable).toBe(false)
    const result = await publishWorkToPlatform(async () => 'jwt', work)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: '公開先が設定されていません' })
  })
})
