// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { urlKeyOf } from '../../../src/core/board/link'
import { fakeLink, makeBoardDb } from '../board/board-test-util'
import { type BoardLinkEnv, resolveLinkCards } from './board-link-fetch'

/**
 * 掲示板のリンク取得（functions/api/_lib/board-link-fetch.ts）。
 *
 * ここで固定するのは設計 09-board の不変条件 8・9 と §3.1 の防御。
 * **「取りに行かなかったこと」を fetch の呼び出し回数で見る**のが要点で、
 * 返り値だけ見ていると「取りに行った上で捨てた」との区別が付かない（＝ SSRF は素通り）。
 */

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const WEEK = 7 * 24 * HOUR

const fetchMock = vi.fn()
const realFetch = globalThis.fetch

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function makeEnv(over: Partial<BoardLinkEnv> = {}) {
  const store = makeBoardDb()
  const env: BoardLinkEnv = { DB: store.db, ...over }
  return { env, store }
}

const html = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`

function htmlRes(head: string, init: { status?: number; type?: string } = {}): Response {
  return new Response(html(head), {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'text/html; charset=utf-8' },
  })
}

function redirectRes(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

/** fetch に渡された URL を出現順で並べる。 */
const fetchedUrls = () => fetchMock.mock.calls.map((c) => String(c[0]))

// ---------------------------------------------------------------------------

describe('resolveLinkCards — 取りに行ってよい URL の判断（不変条件 8）', () => {
  it('http・IP リテラル・非標準ポート・自オリジンは 1 度も取りに行かない', async () => {
    const denied = [
      'http://example.com/a', // https 以外
      'https://192.168.0.1/a', // IP リテラル
      'https://example.com:8443/a', // 非標準ポート
      'https://cotonoha-leaf.org/x', // 自オリジン
      'https://foo.pages.dev/x', // 自オリジン（プレビュー）
      'https://localhost/x', // 自オリジン
      'https://user@example.com/x', // ユーザー情報つき
      'https://box.internal/x', // 内部 TLD
    ]
    // 1 投稿で扱うのは 2 本までなので、1 本ずつ別の投稿として流す
    for (const url of denied) {
      const { env, store } = makeEnv()
      const cards = await resolveLinkCards(env, `見て → ${url}`, NOW)
      expect(cards, url).toEqual([])
      expect(fetchMock, url).not.toHaveBeenCalled()
      // 拒否も negative cache に入る（1 時間）＝同じ URL の連打で毎回判定し直さない
      const rows = [...store.links.values()]
      expect(
        rows.map((r) => r.kind),
        url,
      ).toEqual(['none'])
      expect(rows[0]?.expires_at, url).toBe(NOW + HOUR)
      fetchMock.mockReset()
    }
  })

  it('リダイレクト先が拒否対象なら、そのホップで止まる', async () => {
    const { env, store } = makeEnv()
    // 外向きの URL に見せて 302 で内側（メタデータサーバ）へ飛ばす典型
    fetchMock.mockResolvedValueOnce(redirectRes('https://169.254.169.254/latest/meta-data/'))

    const cards = await resolveLinkCards(env, 'https://example.com/a', NOW)

    expect(cards).toEqual([])
    // 1 ホップ目だけ。飛び先は取りに行っていない
    expect(fetchedUrls()).toEqual(['https://example.com/a'])
    expect([...store.links.values()][0]?.kind).toBe('none')
  })

  it('リダイレクト先が自オリジンでも止まる（初回だけの検査では素通りする経路）', async () => {
    const { env } = makeEnv()
    fetchMock.mockResolvedValueOnce(redirectRes('https://cotonoha-leaf.org/api/board/threads'))

    expect(await resolveLinkCards(env, 'https://example.com/a', NOW)).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('リダイレクトは 3 回まで追い、4 回目であきらめる', async () => {
    const { env } = makeEnv()
    for (let i = 1; i <= 5; i++) {
      fetchMock.mockResolvedValueOnce(redirectRes(`https://example.com/${i}`))
    }

    expect(await resolveLinkCards(env, 'https://example.com/0', NOW)).toEqual([])
    // 初回 ＋ リダイレクト 3 回 = 4 回
    expect(fetchedUrls()).toEqual([
      'https://example.com/0',
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ])
  })

  it('リダイレクトを追ったうえで取得できたら、毎ホップの検査を通ってカードになる', async () => {
    const { env } = makeEnv()
    fetchMock
      .mockResolvedValueOnce(redirectRes('https://www.example.com/a', 301))
      .mockResolvedValueOnce(htmlRes('<meta property="og:title" content="移動先">'))

    const cards = await resolveLinkCards(env, 'https://example.com/a', NOW)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.title).toBe('移動先')
    // 表示は**本文に書かれた URL のまま**（リンクの見た目と飛び先を食い違わせない・設計 §3.2）
    expect(cards[0]?.url).toBe('https://example.com/a')
    expect(cards[0]?.host).toBe('example.com')
  })

  it('fetch には redirect:manual と AbortSignal を必ず渡す', async () => {
    const { env } = makeEnv()
    fetchMock.mockResolvedValueOnce(htmlRes('<title>t</title>'))

    await resolveLinkCards(env, 'https://example.com/a', NOW)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('resolveLinkCards — 応答の扱い', () => {
  it('タイムアウト（fetch の reject）は伝播せず、1 時間の negative cache になる', async () => {
    const { env, store } = makeEnv()
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    )

    // 投稿そのものは通す＝リンクが 1 本死んでいるだけで書き込みが失敗しない
    const cards = await resolveLinkCards(env, 'https://slow.example.com/a', NOW)

    expect(cards).toEqual([])
    const row = [...store.links.values()][0]
    expect(row?.kind).toBe('none')
    expect(row?.expires_at).toBe(NOW + HOUR)
  })

  it('text/html 以外と 200 以外は捨てる', async () => {
    const { env } = makeEnv()
    fetchMock.mockResolvedValueOnce(
      new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
    )
    expect(await resolveLinkCards(env, 'https://example.com/a.pdf', NOW)).toEqual([])

    const second = makeEnv()
    fetchMock.mockResolvedValueOnce(htmlRes('<title>404</title>', { status: 404 }))
    expect(await resolveLinkCards(second.env, 'https://example.com/none', NOW)).toEqual([])
  })

  it('巨大なレスポンスは 256KB で打ち切り、残りは読まない', async () => {
    const { env } = makeEnv()
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
    const counter = { pulls: 0, cancelled: false }
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        counter.pulls++
        // 打ち切りが効かなければ 64MB 読み込むことになる
        if (counter.pulls > 1000) {
          controller.close()
          return
        }
        controller.enqueue(counter.pulls === 1 ? new TextEncoder().encode(HEADLESS_HEAD) : chunk)
      },
      cancel() {
        counter.cancelled = true
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { headers: { 'content-type': 'text/html' } }),
    )

    const cards = await resolveLinkCards(env, 'https://huge.example.com/a', NOW)

    // 先頭に入れた og:title は読めている
    expect(cards[0]?.title).toBe('でかいページ')
    // 256KB ぶん（64KB × 4）＋ 先頭チャンクで足りる。青天井に読み続けていない
    expect(counter.pulls).toBeLessThanOrEqual(6)
    expect(counter.cancelled).toBe(true)
  })

  it('</head> が来たらそこで読むのをやめる', async () => {
    const { env } = makeEnv()
    const counter = { pulls: 0, cancelled: false }
    const parts = [
      '<html><head><meta property="og:title" content="頭だけ"></head>',
      '<body>'.padEnd(64 * 1024, 'y'),
      '</body></html>',
    ]
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[counter.pulls]
        counter.pulls++
        if (part === undefined) controller.close()
        else controller.enqueue(new TextEncoder().encode(part))
      },
      cancel() {
        counter.cancelled = true
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { headers: { 'content-type': 'text/html' } }),
    )

    const cards = await resolveLinkCards(env, 'https://example.com/a', NOW)

    expect(cards[0]?.title).toBe('頭だけ')
    // 3 つ目のチャンク（`</body>`）までは絶対に来ない。
    // 2 まで許すのは、ストリームの実装が 1 つ先読みするため（読み込みの打ち切りとは別の話）。
    expect(counter.pulls).toBeLessThanOrEqual(2)
    expect(counter.cancelled).toBe(true)
  })
})

/** 先頭チャンク。`</head>` を含めない＝バイト数の打ち切りだけで止まるか見る。 */
const HEADLESS_HEAD = '<html><head><meta property="og:title" content="でかいページ">'

describe('resolveLinkCards — og:image の許可表（不変条件 9）', () => {
  it('許可表の外のホストは image_url が空（テキストカードに落ちる）', async () => {
    const { env, store } = makeEnv()
    fetchMock.mockResolvedValueOnce(
      htmlRes(
        [
          '<meta property="og:title" content="なりすまし">',
          // ドット境界の接尾辞一致なので twimg.com には当たらない
          '<meta property="og:image" content="https://evil-twimg.com/a.png">',
        ].join(''),
      ),
    )

    const cards = await resolveLinkCards(env, 'https://example.com/a', NOW)

    expect(cards[0]?.imageUrl).toBe('')
    const row = [...store.links.values()][0]
    expect(row?.image_ok).toBe(0)
    expect(row?.image_url).toBe('')
  })

  it('許可表のホストなら image_url が入る（7 日 TTL）', async () => {
    const { env, store } = makeEnv()
    fetchMock.mockResolvedValueOnce(
      htmlRes(
        [
          '<meta property="og:title" content="ポスト">',
          '<meta property="og:image" content="https://pbs.twimg.com/media/a.png">',
          '<meta property="og:site_name" content="X">',
        ].join(''),
      ),
    )

    const cards = await resolveLinkCards(env, 'https://x.com/i/status/1', NOW)

    expect(cards[0]?.imageUrl).toBe('https://pbs.twimg.com/media/a.png')
    expect(cards[0]?.siteName).toBe('X')
    const row = [...store.links.values()][0]
    expect(row?.image_ok).toBe(1)
    expect(row?.expires_at).toBe(NOW + WEEK)
  })
})

describe('resolveLinkCards — キャッシュ（D-BOARD-OGPCACHE）', () => {
  it('期限内のキャッシュがあれば外へ取りに行かない', async () => {
    const { env, store } = makeEnv()
    const url = 'https://example.com/a'
    const key = await urlKeyOf(url)
    store.links.set(key, fakeLink({ url_key: key, url, host: 'example.com', expires_at: NOW + 1 }))

    const cards = await resolveLinkCards(env, `どうぞ ${url}`, NOW)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(cards).toEqual([
      {
        url,
        host: 'example.com',
        kind: 'ogp',
        title: 'タイトル',
        description: '説明',
        imageUrl: '',
        siteName: 'example',
      },
    ])
  })

  it('期限切れなら取り直す', async () => {
    const { env, store } = makeEnv()
    const url = 'https://example.com/a'
    const key = await urlKeyOf(url)
    store.links.set(key, fakeLink({ url_key: key, url, title: '古い', expires_at: NOW }))
    fetchMock.mockResolvedValueOnce(htmlRes('<meta property="og:title" content="新しい">'))

    const cards = await resolveLinkCards(env, url, NOW)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cards[0]?.title).toBe('新しい')
  })

  it('blocked_at の入った URL はカードを返さず、取り直しもしない', async () => {
    const { env, store } = makeEnv()
    const url = 'https://example.com/a'
    const key = await urlKeyOf(url)
    // 期限は切れているが、運営が潰した URL は再取得で復活させない
    store.links.set(key, fakeLink({ url_key: key, url, expires_at: 0, blocked_at: NOW - 1 }))

    expect(await resolveLinkCards(env, url, NOW)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.links.get(key)?.blocked_at).toBe(NOW - 1)
  })

  it('kind=none のキャッシュはカードを返さない', async () => {
    const { env, store } = makeEnv()
    const url = 'https://example.com/a'
    const key = await urlKeyOf(url)
    store.links.set(key, fakeLink({ url_key: key, url, kind: 'none', expires_at: NOW + 1 }))

    expect(await resolveLinkCards(env, url, NOW)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('resolveLinkCards — 本数と重複', () => {
  it('カードにするのは先頭 2 本まで（3 本目は取りに行かない）', async () => {
    const { env } = makeEnv()
    fetchMock
      .mockResolvedValueOnce(htmlRes('<title>1</title>'))
      .mockResolvedValueOnce(htmlRes('<title>2</title>'))
      .mockResolvedValueOnce(htmlRes('<title>3</title>'))

    const body = 'https://a.example.com/1 https://b.example.com/2 https://c.example.com/3'
    const cards = await resolveLinkCards(env, body, NOW)

    expect(fetchedUrls()).toEqual(['https://a.example.com/1', 'https://b.example.com/2'])
    expect(cards.map((c) => c.host)).toEqual(['a.example.com', 'b.example.com'])
  })

  it('正規化して同じになる URL は 1 回しか取りに行かない', async () => {
    const { env } = makeEnv()
    fetchMock.mockResolvedValueOnce(htmlRes('<title>同じ</title>'))

    const body = 'https://example.com/a?utm_source=x と https://example.com/a#anchor'
    const cards = await resolveLinkCards(env, body, NOW)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.url).toBe('https://example.com/a')
  })

  it('URL の無い本文では D1 も外部も触らない', async () => {
    const { env, store } = makeEnv()
    expect(await resolveLinkCards(env, 'ふつうの本文です。', NOW)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.links.size).toBe(0)
  })
})

describe('resolveLinkCards — grove の作品カード（D-BOARD-WORKCARD）', () => {
  const grove = 'https://grove.cotonoha-leaf.org'

  it('grove の URL は自オリジンの接尾辞でも取りに行き、kind=work になる', async () => {
    const { env, store } = makeEnv({ PLATFORM_ORIGIN: grove })
    fetchMock.mockResolvedValueOnce(
      htmlRes(
        [
          '<meta property="og:title" content="夜明けの手紙">',
          '<meta property="og:image" content="https://grove.cotonoha-leaf.org/cover/1.png">',
        ].join(''),
      ),
    )

    const cards = await resolveLinkCards(env, `${grove}/works/1`, NOW)

    expect(fetchedUrls()).toEqual([`${grove}/works/1`])
    expect(cards[0]?.kind).toBe('work')
    // grove のホストは実行時に許可表へ足すので、表紙画像が出る
    expect(cards[0]?.imageUrl).toBe('https://grove.cotonoha-leaf.org/cover/1.png')
    expect(store.links.get(await urlKeyOf(`${grove}/works/1`))?.kind).toBe('work')
  })

  it('grove から自オリジンへ飛ばされたら止まる（例外はホスト完全一致だけ）', async () => {
    const { env } = makeEnv({ PLATFORM_ORIGIN: grove })
    fetchMock.mockResolvedValueOnce(redirectRes('https://cotonoha-leaf.org/api/board/threads'))

    expect(await resolveLinkCards(env, `${grove}/works/1`, NOW)).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('PLATFORM_ORIGIN が未設定なら本番 grove は自オリジンとして拒否される', async () => {
    const { env } = makeEnv()
    expect(await resolveLinkCards(env, `${grove}/works/1`, NOW)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('grove 以外のホストは kind=ogp のまま', async () => {
    const { env } = makeEnv({ PLATFORM_ORIGIN: grove })
    fetchMock.mockResolvedValueOnce(htmlRes('<title>よそ</title>'))

    const cards = await resolveLinkCards(env, 'https://example.com/a', NOW)
    expect(cards[0]?.kind).toBe('ogp')
  })
})

describe('resolveLinkCards — BOARD_SELF_HOSTS', () => {
  it('環境変数で足したホストも自オリジンとして拒否する', async () => {
    const { env } = makeEnv({ BOARD_SELF_HOSTS: 'internal.example.com , admin.example.com' })

    expect(await resolveLinkCards(env, 'https://admin.example.com/x', NOW)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
