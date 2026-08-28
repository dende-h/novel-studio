// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/posts のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込みは 401
 *   §7-2  表示名が未設定のまま投稿すると 409
 *   §7-4  自分以外の投稿は削除できない（403）
 *   §7-5  スレ本文（seq=1）はこの経路で消せない＝スレの DELETE に回す
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタと混ざらない
 *
 * 加えて、権限の否決が `STATUS_OF_REASON`（src/core/board/permission.ts）どおりの
 * ステータスで出ることを見る（ロック 409・投稿禁止 403・消えたスレ 404）。
 * ここが崩れると、画面が「書けない理由」を出し分けられなくなる。
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
import { BOARD_LIMITS } from '../../../src/core/board/types'
import { BOARD_ACTIONS_PER_MINUTE } from './board-endpoint'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestDelete, onRequestPost } from './posts'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000
const WINDOW = Math.floor(NOW / 60_000) * 60_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const post = (env: unknown, query: string, body: unknown) =>
  (onRequestPost as unknown as Handler)({
    request: new Request(`https://x/api/board/posts${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

const del = (env: unknown, query: string) =>
  (onRequestDelete as unknown as Handler)({
    request: new Request(`https://x/api/board/posts${query}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer x' },
    }),
    env,
  })

/**
 * 表示名のある user_1・user_2 と、スレ t1（本文 p1 は user_1）。
 * 返信の宛先になるスレを 1 本だけ用意し、各テストは必要なぶんだけ足す。
 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' }),
      fakeProfile({ user_id: 'user_2', display_name: 'ひなた', name_key: 'ひなた' }),
    ],
    threads: [fakeThread({ id: 't1', user_id: 'user_1', bumped_at: 1000 })],
    posts: [fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', body: 'スレ本文' })],
  })
  return { store, env: makeBoardEnv({ store }) }
}

const validInput = { body: '同じことを思っていました' }

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

describe('POST /api/board/posts', () => {
  it('未ログインは 401（§7-1）', async () => {
    const { env, store } = setup()
    authState.userId = null
    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(401)
    expect(store.posts.size).toBe(1)
  })

  it('宛先のスレを指していなければ 400', async () => {
    const { env } = setup()
    expect((await post(env, '', validInput)).status).toBe(400)
    expect((await post(env, '?thread=', validInput)).status).toBe(400)
  })

  it('入力が契約に合わなければ 400（投稿は作らない）', async () => {
    const { env, store } = setup()
    const cases: unknown[] = [
      'not json',
      {},
      { body: '' },
      { body: '   ' },
      { body: 'あ'.repeat(BOARD_LIMITS.body + 1) },
      { ...validInput, replyTo: -1 },
      { ...validInput, replyTo: 1.5 },
    ]
    for (const c of cases) {
      const res = await post(env, '?thread=t1', c)
      expect([res.status, JSON.stringify(c)]).toEqual([400, JSON.stringify(c)])
    }
    expect(store.posts.size).toBe(1)
  })

  it('表示名が未設定なら 409 profile_required（§7-2）', async () => {
    const { env, store } = setup()
    store.profiles.delete('user_1')
    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_required' })
    expect(store.posts.size).toBe(1)
  })

  it('無いスレは 404。消えた・伏せられたスレも 404（gone）', async () => {
    const { env, store } = setup()
    expect((await post(env, '?thread=nope', validInput)).status).toBe(404)

    store.threads.set('t1', fakeThread({ id: 't1', deleted_at: NOW - 1 }))
    const deleted = await post(env, '?thread=t1', validInput)
    expect(deleted.status).toBe(404)
    expect(await deleted.json()).toEqual({ error: 'gone' })

    store.threads.set('t1', fakeThread({ id: 't1', hidden_at: NOW - 1 }))
    expect((await post(env, '?thread=t1', validInput)).status).toBe(404)
    expect(store.posts.size).toBe(1)
  })

  it('ロックされたスレは 409。staff だけは書ける（締めの一言）', async () => {
    const { env, store } = setup()
    store.threads.set('t1', fakeThread({ id: 't1', locked: 1 }))

    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'locked' })
    expect(store.posts.size).toBe(1)

    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', role: 'staff' }))
    expect((await post(env, '?thread=t1', validInput)).status).toBe(201)
  })

  it('投稿禁止中は 403（期限が切れていれば書ける）', async () => {
    const { env, store } = setup()
    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', banned_until: NOW + 1000 }))

    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned', bannedUntil: NOW + 1000 })
    expect(store.posts.size).toBe(1)

    // bannedUntil === now は明けたものとして扱う。
    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', banned_until: NOW }))
    expect((await post(env, '?thread=t1', validInput)).status).toBe(201)
  })

  it('レート制限のキーは `board:` 接頭辞で、同期のカウンタと混ざらない（§7-11）', async () => {
    const { env, store } = setup()
    // 同期の枠（素の user_id）が使い切られていても、掲示板には書ける。
    store.rates.set('user_1', { user_id: 'user_1', window_start: WINDOW, count: 60 })

    expect((await post(env, '?thread=t1', validInput)).status).toBe(201)
    expect(store.rates.get('board:user_1')).toMatchObject({ window_start: WINDOW, count: 1 })
    expect(store.rates.get('user_1')?.count).toBe(60)
  })

  it('分あたりの安全弁を使い切っていたら 429（連打を止める枠）', async () => {
    const { env, store } = setup()
    store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: BOARD_ACTIONS_PER_MINUTE,
    })

    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(store.posts.size).toBe(1)
  })

  it('1 時間に書けるのは BOARD_LIMITS.postsPerHour 件まで。分窓をまたいでも増えない（D-BOARD-OPEN）', async () => {
    const { env, store } = setup()
    // 分窓の安全弁（60 秒）だけで守っていたころは、**61 秒ずつ進めれば何件でも書けた**。
    // その手順をそのまま再現する: 1 分ずつずらしながら 12 回投げる。
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(NOW + i * 61_000)
      statuses.push((await post(env, '?thread=t1', validInput)).status)
    }

    // 通るのは 10 件目まで。11 件目からは時間枠で 429。
    expect(statuses).toEqual([...Array(BOARD_LIMITS.postsPerHour).fill(201), 429, 429])
    expect(store.posts.size).toBe(1 + BOARD_LIMITS.postsPerHour)

    const last = await post(env, '?thread=t1', validInput)
    expect(last.status).toBe(429)
    expect(await last.json()).toEqual({ error: 'too_many_posts' })

    // 1 時間ぶん進めば、また書ける（窓が滑るだけで、恒久的に止めるものではない）。
    vi.setSystemTime(NOW + 11 * 61_000 + 60 * 60 * 1000)
    expect((await post(env, '?thread=t1', validInput)).status).toBe(201)
  })

  it('時間枠で断ったリクエストは分窓のカウンタを進めない', async () => {
    const { env, store } = setup()
    for (let i = 0; i < BOARD_LIMITS.postsPerHour; i++) {
      store.posts.set(
        `old${i}`,
        fakePost({ id: `old${i}`, thread_id: 'other', seq: i + 1, created_at: NOW - 1000 }),
      )
    }

    expect((await post(env, '?thread=t1', validInput)).status).toBe(429)
    expect(store.rates.has('board:user_1')).toBe(false)
  })

  it('削除済みの投稿も 1 時間の枠に数える（消して書き直す抜け道を作らない）', async () => {
    const { env, store } = setup()
    for (let i = 0; i < BOARD_LIMITS.postsPerHour; i++) {
      store.posts.set(
        `old${i}`,
        fakePost({
          id: `old${i}`,
          thread_id: 'other',
          seq: i + 1,
          created_at: NOW - 1000,
          deleted_at: NOW - 500,
        }),
      )
    }
    expect((await post(env, '?thread=t1', validInput)).status).toBe(429)
  })

  it('レスポンスに private, no-store が付く（閲覧者ごとに中身が違う）', async () => {
    const { env } = setup()
    const res = await post(env, '?thread=t1', validInput)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('bumped_at の更新は 1 回だけ（createPost の batch と二重に打たない）', async () => {
    const { env, store } = setup()
    const prepare = vi.spyOn(store.db, 'prepare')

    expect((await post(env, '?thread=t1', validInput)).status).toBe(201)

    const bumps = prepare.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.startsWith('UPDATE board_threads SET bumped_at'))
    expect(bumps).toHaveLength(1)
    expect(store.threads.get('t1')).toMatchObject({ bumped_at: NOW, reply_count: 1 })
    prepare.mockRestore()
  })

  it('seq の採番が競合したら 1 回だけ取り直す。それでも駄目なら 409（500 にしない）', async () => {
    const { env, store } = setup()
    const real = store.db.prepare.bind(store.db)
    let fail = 1
    const prepare = vi.spyOn(store.db, 'prepare').mockImplementation((sql: string) => {
      const stmt = real(sql)
      if (!sql.startsWith('INSERT INTO board_posts') || fail-- <= 0) return stmt
      // UNIQUE(thread_id, seq) の衝突を、同時投稿の 2 本目と同じ形で起こす。
      return {
        ...stmt,
        bind: () => ({
          ...stmt,
          run: async () => {
            throw new Error('UNIQUE constraint failed: board_posts.thread_id, board_posts.seq')
          },
        }),
      } as unknown as ReturnType<typeof real>
    })

    // 1 回目は落ちるが、取り直して 201（書いた本文を捨てない）。
    const res = await post(env, '?thread=t1', validInput)
    expect(res.status).toBe(201)
    expect(store.posts.size).toBe(2)

    // 2 回続けて落ちたら 409。500 にすると、利用者は再送していいのかが分からない。
    fail = 2
    const conflict = await post(env, '?thread=t1', validInput)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'conflict' })
    expect(store.posts.size).toBe(2)
    prepare.mockRestore()
  })

  it('返信は seq=2 から積まれ、スレが最終書き込み順で持ち上がる', async () => {
    const { env, store } = setup()
    const res = await post(env, '?thread=t1', { body: 'わたしも欲しい', replyTo: 1 })
    expect(res.status).toBe(201)

    const created = (await res.json()) as { id: string; threadId: string; seq: number }
    expect(created).toMatchObject({ threadId: 't1', seq: 2 })
    expect(store.posts.get(created.id)).toMatchObject({
      thread_id: 't1',
      seq: 2,
      user_id: 'user_1',
      body: 'わたしも欲しい',
      reply_to: 1,
      created_at: NOW,
      deleted_at: 0,
      hidden_at: 0,
    })
    // bumped_at が進み、返信数（seq>=2 の生きている投稿）が数え直される。
    expect(store.threads.get('t1')).toMatchObject({ bumped_at: NOW, reply_count: 1 })

    // 続けて書けば 3 番になる（本文 seq=1 を含めた通し番号）。
    const second = (await (await post(env, '?thread=t1', validInput)).json()) as { seq: number }
    expect(second.seq).toBe(3)
    expect(store.threads.get('t1')?.reply_count).toBe(2)
  })

  it('replyTo は省略できる（スレ全体への返信＝0）', async () => {
    const { env, store } = setup()
    const { id } = (await (await post(env, '?thread=t1', validInput)).json()) as { id: string }
    expect(store.posts.get(id)?.reply_to).toBe(0)
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

    const body = `これ見ました ${url}`
    const created = (await (await post(env, '?thread=t1', { body })).json()) as { id: string }
    // 本文と now をそのまま渡す（env は OGP 取得の設定を持っている）。
    expect(links.resolveLinkCards).toHaveBeenCalledWith(env, body, NOW)
    expect([...store.postLinks.values()]).toEqual([
      { post_id: created.id, url_key: await urlKeyOf(url), ord: 0 },
    ])

    // 相手サイトが落ちていても、書き込みは 201（保存済みの本文を巻き戻さない）。
    links.resolveLinkCards.mockImplementation(async () => {
      throw new Error('相手サイトが落ちている')
    })
    const second = await post(env, '?thread=t1', validInput)
    expect(second.status).toBe(201)
    expect(store.posts.size).toBe(3)
  })
})

describe('DELETE /api/board/posts', () => {
  /** setup() に user_1 の返信 p2 と user_2 の返信 p3 を足す。 */
  function withReplies(): { store: BoardDbFake; env: unknown } {
    const { store, env } = setup()
    store.posts.set(
      'p2',
      fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_1', body: 'わたしの返信' }),
    )
    store.posts.set(
      'p3',
      fakePost({ id: 'p3', thread_id: 't1', seq: 3, user_id: 'user_2', body: '他人の返信' }),
    )
    return { store, env }
  }

  it('未ログインは 401（§7-1）', async () => {
    const { env, store } = withReplies()
    authState.userId = null
    expect((await del(env, '?id=p2')).status).toBe(401)
    expect(store.posts.get('p2')?.deleted_at).toBe(0)
  })

  it('id が無ければ 400・知らない id は 404', async () => {
    const { env } = withReplies()
    expect((await del(env, '')).status).toBe(400)
    expect((await del(env, '?id=')).status).toBe(400)
    expect((await del(env, '?id=nope')).status).toBe(404)
  })

  it('他人の投稿は削除できない（403・§7-4）', async () => {
    const { env, store } = withReplies()
    const res = await del(env, '?id=p3')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(store.posts.get('p3')?.deleted_at).toBe(0)
  })

  it('staff でも他人の投稿は削除できない（運営がやるのは非表示）', async () => {
    const { env, store } = withReplies()
    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', role: 'staff' }))
    expect((await del(env, '?id=p3')).status).toBe(403)
    expect(store.posts.get('p3')?.deleted_at).toBe(0)
  })

  it('スレ本文（seq=1）は単体で消せない。409 でスレの DELETE に回す（§7-5）', async () => {
    const { env, store } = withReplies()
    const res = await del(env, '?id=p1')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'use_thread_delete' })
    expect(store.posts.get('p1')?.deleted_at).toBe(0)

    // 他人のスレ本文は、そもそも所有者でない時点で 403（409 より先に断る）。
    store.posts.set('p1', fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_2' }))
    expect((await del(env, '?id=p1')).status).toBe(403)
  })

  it('自分の返信は論理削除される。行は残り、返信数は数え直される', async () => {
    const { env, store } = withReplies()
    const res = await del(env, '?id=p2')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // **行は消さない**（D-BOARD-DELETE）。本文の伏字は読み出し側（board-store）の仕事。
    expect(store.posts.get('p2')).toMatchObject({
      id: 'p2',
      body: 'わたしの返信',
      deleted_at: NOW,
    })
    // 生きている返信は p3 だけになる。
    expect(store.threads.get('t1')?.reply_count).toBe(1)
  })

  it('二重削除は 404（gone）。1 度目の削除時刻を上書きしない', async () => {
    const { env, store } = withReplies()
    expect((await del(env, '?id=p2')).status).toBe(200)

    vi.setSystemTime(NOW + 60_000)
    const again = await del(env, '?id=p2')
    expect(again.status).toBe(404)
    expect(await again.json()).toEqual({ error: 'gone' })
    expect(store.posts.get('p2')?.deleted_at).toBe(NOW)
  })
})
