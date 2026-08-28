// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/threads のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込みは 401・読み取りは 200
 *   §7-2  表示名が未設定のまま投稿すると 409
 *   §7-6  削除・非表示の投稿は一覧でも本文を返さない（伏字）
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタと混ざらない
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（分窓のレート制限が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

// リンクカードの取得（外部への fetch）そのものは board-link-fetch のテストの領分。
// ここでは「呼ばれること・結果が board_post_links に結ばれること・失敗しても
// 投稿が成立すること」だけを見る。
const links = vi.hoisted(() => ({
  resolveLinkCards: vi.fn(async (): Promise<unknown[]> => []),
}))
vi.mock('../_lib/board-link-fetch', () => links)

import { urlKeyOf } from '../../../src/core/board/link'
import { DELETED_BODY_TEXT } from '../../../src/core/board/permission'
import { BOARD_LIMITS } from '../../../src/core/board/types'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestGet, onRequestPost } from './threads'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000
const WINDOW = Math.floor(NOW / 60_000) * 60_000
const DAY = 24 * 60 * 60 * 1000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const get = (env: unknown, query = '') =>
  (onRequestGet as unknown as Handler)({
    request: new Request(`https://x/api/board/threads${query}`, {
      headers: { authorization: 'Bearer x' },
    }),
    env,
  })

const post = (env: unknown, body: unknown) =>
  (onRequestPost as unknown as Handler)({
    request: new Request('https://x/api/board/threads', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

/** 表示名のある user_1 と、空の掲示板。 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({ profiles: [fakeProfile({ user_id: 'user_1' })] })
  return { store, env: makeBoardEnv({ store }) }
}

const validInput = { kind: 'request', title: '検索が欲しい', body: '全文検索が欲しいです' }

beforeEach(() => {
  authState.userId = 'user_1'
  links.resolveLinkCards.mockClear()
  links.resolveLinkCards.mockImplementation(async () => [])
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/board/threads', () => {
  /** 一覧の見え方を確かめるための、スレ 3 本ぶんの下ごしらえ。 */
  function seeded(): BoardDbFake {
    const store = makeBoardDb({
      profiles: [fakeProfile({ user_id: 'user_1', display_name: 'あかり' })],
      threads: [
        fakeThread({ id: 'a', kind: 'suggestion', pinned: 1, bumped_at: 1000, title: '目安箱' }),
        fakeThread({ id: 'b', kind: 'request', bumped_at: 3000, title: '要望' }),
        fakeThread({ id: 'c', kind: 'bug', bumped_at: 5000, title: '不具合' }),
        fakeThread({ id: 'x', kind: 'chat', bumped_at: 9000, deleted_at: 100 }),
        fakeThread({ id: 'y', kind: 'chat', bumped_at: 9000, hidden_at: 100 }),
      ],
      posts: [
        fakePost({ id: 'pa', thread_id: 'a', body: 'ひとことどうぞ' }),
        fakePost({ id: 'pb', thread_id: 'b', body: '要望の本文' }),
        fakePost({ id: 'pc', thread_id: 'c', body: '不具合の本文' }),
      ],
    })
    return store
  }

  it('未ログインでも 200（§7-1 読み取り）。削除・非表示のスレは出ない', async () => {
    authState.userId = null
    const store = seeded()
    const res = await get(makeBoardEnv({ store }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { threads: { id: string }[]; nextCursor: string | null }
    expect(body.threads.map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(body.nextCursor).toBeNull()
  })

  it('ピン留めが先頭、あとは最終書き込み順。抜粋と作者名が入る', async () => {
    const store = seeded()
    const body = (await (await get(makeBoardEnv({ store }))).json()) as {
      threads: { id: string; pinned: boolean; excerpt: string; author: { displayName: string } }[]
    }
    expect(body.threads[0]).toMatchObject({ id: 'a', pinned: true, excerpt: 'ひとことどうぞ' })
    expect(body.threads[0]?.author.displayName).toBe('あかり')
  })

  it('未ログインは mine / liked が false。ログインしていれば埋まる', async () => {
    const store = seeded()
    store.likes.set('c:user_1', { thread_id: 'c', user_id: 'user_1', created_at: 1 })
    const env = makeBoardEnv({ store })

    authState.userId = null
    const anon = (await (await get(env)).json()) as { threads: { mine: boolean; liked: boolean }[] }
    expect(anon.threads.every((t) => !t.mine && !t.liked)).toBe(true)

    authState.userId = 'user_1'
    const mine = (await (await get(env)).json()) as {
      threads: { id: string; mine: boolean; liked: boolean }[]
    }
    expect(mine.threads.find((t) => t.id === 'c')).toMatchObject({ mine: true, liked: true })
    expect(mine.threads.find((t) => t.id === 'b')).toMatchObject({ mine: true, liked: false })
  })

  it('kind で絞り込める。知らない kind は絞り込みなしに倒す（400 にしない）', async () => {
    const env = makeBoardEnv({ store: seeded() })
    const only = (await (await get(env, '?kind=bug')).json()) as { threads: { id: string }[] }
    expect(only.threads.map((t) => t.id)).toEqual(['c'])

    const bogus = (await (await get(env, '?kind=nope')).json()) as { threads: { id: string }[] }
    expect(bogus.threads.map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('cursor で続きが取れる（同じスレを 2 度返さない）', async () => {
    const store = seeded()
    const env = makeBoardEnv({ store })
    // 1 ページ 20 件なので、境界の確認はカーソルを手で渡して行う。
    // `pinned:bumped_at:id` の形（board-store の encodeCursor）。
    const page2 = (await (await get(env, '?cursor=1%3A1000%3Aa')).json()) as {
      threads: { id: string }[]
    }
    expect(page2.threads.map((t) => t.id)).toEqual(['c', 'b'])
  })

  it('本文を消したスレは、一覧の抜粋も伏字になる（§7-6）', async () => {
    const store = seeded()
    const head = store.posts.get('pb')
    if (head) store.posts.set('pb', { ...head, deleted_at: NOW })

    const body = (await (await get(makeBoardEnv({ store }))).json()) as {
      threads: { id: string; excerpt: string }[]
    }
    expect(body.threads.find((t) => t.id === 'b')?.excerpt).toBe(DELETED_BODY_TEXT)
    expect(JSON.stringify(body)).not.toContain('要望の本文')
  })
})

describe('POST /api/board/threads', () => {
  it('未ログインは 401（§7-1）', async () => {
    const { env, store } = setup()
    authState.userId = null
    const res = await post(env, validInput)
    expect(res.status).toBe(401)
    expect(store.threads.size).toBe(0)
  })

  it('入力が契約に合わなければ 400（スレは作らない）', async () => {
    const { env, store } = setup()
    const cases: unknown[] = [
      'not json',
      {},
      { ...validInput, kind: 'nope' },
      { ...validInput, title: '   ' },
      { ...validInput, body: '' },
      { ...validInput, title: 'あ'.repeat(BOARD_LIMITS.title + 1) },
      { ...validInput, body: 'あ'.repeat(BOARD_LIMITS.body + 1) },
    ]
    for (const c of cases) {
      const res = await post(env, c)
      expect([res.status, JSON.stringify(c)]).toEqual([400, JSON.stringify(c)])
    }
    expect(store.threads.size).toBe(0)
  })

  it('表示名が未設定なら 409 profile_required（§7-2）', async () => {
    const store = makeBoardDb()
    const res = await post(makeBoardEnv({ store }), validInput)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_required' })
    expect(store.threads.size).toBe(0)
  })

  it('投稿禁止中は 403', async () => {
    const store = makeBoardDb({
      profiles: [fakeProfile({ user_id: 'user_1', banned_until: NOW + 1000 })],
    })
    const res = await post(makeBoardEnv({ store }), validInput)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'banned' })
    expect(store.threads.size).toBe(0)

    // 期限が切れていれば書ける（bannedUntil === now は明けたものとして扱う）。
    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', banned_until: NOW }))
    expect((await post(makeBoardEnv({ store }), validInput)).status).toBe(201)
  })

  it('1 日に立てられるのは BOARD_LIMITS.threadsPerDay 本まで（消しても数える）', async () => {
    const { env, store } = setup()
    for (let i = 0; i < BOARD_LIMITS.threadsPerDay; i++) {
      store.threads.set(`old${i}`, fakeThread({ id: `old${i}`, created_at: NOW - 1000 }))
    }
    // 削除済みでも上限に数える（消して立て直す抜け道を作らない）。
    store.threads.set('old0', fakeThread({ id: 'old0', created_at: NOW - 1000, deleted_at: NOW }))

    const res = await post(env, validInput)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'too_many_threads' })

    // 24 時間より前のスレは数えない。
    for (let i = 0; i < BOARD_LIMITS.threadsPerDay; i++) {
      store.threads.set(`old${i}`, fakeThread({ id: `old${i}`, created_at: NOW - DAY - 1 }))
    }
    expect((await post(env, validInput)).status).toBe(201)
  })

  it('レート制限のキーは `board:` 接頭辞で、同期のカウンタと混ざらない（§7-11）', async () => {
    const { env, store } = setup()
    // 同期の枠（素の user_id）が使い切られていても、掲示板には書ける。
    store.rates.set('user_1', { user_id: 'user_1', window_start: WINDOW, count: 60 })

    expect((await post(env, validInput)).status).toBe(201)
    expect(store.rates.get('board:user_1')).toMatchObject({ window_start: WINDOW, count: 1 })
    expect(store.rates.get('user_1')?.count).toBe(60)
  })

  it('掲示板の枠を使い切っていたら 429', async () => {
    const { env, store } = setup()
    store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: BOARD_LIMITS.postsPerHour,
    })

    const res = await post(env, validInput)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(store.threads.size).toBe(0)
  })

  it('スレ行と、seq=1 の本文を作る（§4）', async () => {
    const { env, store } = setup()
    const res = await post(env, validInput)
    expect(res.status).toBe(201)

    const created = (await res.json()) as { id: string; postId: string; seq: number }
    expect(created.seq).toBe(1)

    const thread = store.threads.get(created.id)
    expect(thread).toMatchObject({
      kind: 'request',
      title: '検索が欲しい',
      user_id: 'user_1',
      created_at: NOW,
      bumped_at: NOW,
      deleted_at: 0,
      hidden_at: 0,
      status: '',
      pinned: 0,
      locked: 0,
    })

    const post1 = store.posts.get(created.postId)
    expect(post1).toMatchObject({
      thread_id: created.id,
      seq: 1,
      user_id: 'user_1',
      body: '全文検索が欲しいです',
      reply_to: 0,
      created_at: NOW,
    })
    // 立てた直後は一覧にも出る。
    const list = (await (await get(env)).json()) as { threads: { id: string; mine: boolean }[] }
    expect(list.threads.map((t) => t.id)).toEqual([created.id])
    expect(list.threads[0]?.mine).toBe(true)
  })

  it('アンケートを添えられる。締切が過去なら 400 で、スレも作らない', async () => {
    const { env, store } = setup()
    const poll = {
      question: '次に作るなら？',
      options: ['検索', '通知'],
      multiple: false,
      closesAt: NOW + DAY,
    }

    const past = await post(env, { ...validInput, poll: { ...poll, closesAt: NOW - 1 } })
    expect(past.status).toBe(400)
    expect(await past.json()).toMatchObject({ error: 'bad_poll', reason: 'closes_at_past' })
    expect(store.threads.size).toBe(0)
    expect(store.polls.size).toBe(0)

    const ok = await post(env, { ...validInput, poll })
    expect(ok.status).toBe(201)
    const { id } = (await ok.json()) as { id: string }
    expect(store.polls.get(id)).toMatchObject({
      thread_id: id,
      question: '次に作るなら？',
      options: JSON.stringify(['検索', '通知']),
      multiple: 0,
      closes_at: NOW + DAY,
      created_at: NOW,
    })
  })

  it('リンクカードを解決して投稿に結ぶ。取得が失敗しても投稿は成立する', async () => {
    const { env, store } = setup()
    const url = 'https://example.com/a'
    links.resolveLinkCards.mockImplementation(async () => [
      {
        url,
        host: 'example.com',
        kind: 'ogp',
        title: 'あ',
        description: '',
        imageUrl: '',
        siteName: '',
      },
    ])

    const body = `${validInput.body} ${url}`
    const res = await post(env, { ...validInput, body })
    const created = (await res.json()) as { id: string; postId: string }
    // 本文と now をそのまま渡す（env は OGP 取得の設定を持っている）。
    expect(links.resolveLinkCards).toHaveBeenCalledWith(env, body, NOW)
    expect([...store.postLinks.values()]).toEqual([
      { post_id: created.postId, url_key: await urlKeyOf(url), ord: 0 },
    ])

    // 相手サイトが落ちていても、書き込みは 201（保存済みの本文を巻き戻さない）。
    links.resolveLinkCards.mockImplementation(async () => {
      throw new Error('相手サイトが落ちている')
    })
    const second = await post(env, { ...validInput, title: '2 本目' })
    expect(second.status).toBe(201)
    expect(store.threads.size).toBe(2)
  })
})
