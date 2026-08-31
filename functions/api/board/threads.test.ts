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
 * 種別の変更（指摘1・指摘3・指摘4）で、ここが受け持つぶんも固定する。
 *   * お知らせ（`notice`）を立てられるのは staff だけ（member は 403）
 *   * 要望へ統合した `suggestion` は**新規作成だけ**を止める（400）。一覧は合流させる
 *   * 本文の上限は 1500 字（下げる前の 4000 字はもう通らない）
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（分窓のレート制限が実行時刻に依存して揺れないように）。
 * 最後の 1 本だけは実 SQLite（`real-d1.ts`）＝ フェイクは SQL を解釈しないので、
 * 絞り込みの有無で形が変わる一覧の SQL が本当に通るかを別に確かめる。
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
import {
  BOARD_LIMITS,
  CreatePostInputSchema,
  CreateThreadInputSchema,
} from '../../../src/core/board/types'
import { BOARD_ACTIONS_PER_MINUTE } from './board-endpoint'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { makeRealD1, type RealD1 } from './real-d1'
import { onRequestGet, onRequestPost } from './threads'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000
const WINDOW = Math.floor(NOW / 60_000) * 60_000
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

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

  it('レスポンスに private, no-store が付く（mine / liked は閲覧者ごとに違う）', async () => {
    const res = await get(makeBoardEnv({ store: seeded() }))
    // CDN や public/_headers でキャッシュを足したときに、他人の状態が配られないようにする。
    expect(res.headers.get('cache-control')).toBe('private, no-store')
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
    // 一覧の `liked` は**スレ本文（seq=1）への 👍**（0009）。押す相手は投稿の行。
    store.postLikes.set('pc:user_1', { post_id: 'pc', user_id: 'user_1', created_at: 1 })
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

  it('要望のタブは旧「目安箱」のスレも拾う（統合したぶんを一覧から落とさない）', async () => {
    const env = makeBoardEnv({ store: seeded() })
    // `suggestion` は `request` へ統合した。タブから漏らすと、目安箱に書いた利用者には
    // 「自分のスレが消えた」に見える（保存済みの kind は書き換えない方針）。
    const merged = (await (await get(env, '?kind=request')).json()) as {
      threads: { id: string; kind: string }[]
    }
    expect(merged.threads.map((t) => t.id)).toEqual(['a', 'b'])
    expect(merged.threads.map((t) => t.kind)).toEqual(['suggestion', 'request'])

    // 旧クライアントやブックマークの `?kind=suggestion` も同じ集合に寄せる
    //（要望の一覧を空で見せない）。
    const legacy = (await (await get(env, '?kind=suggestion')).json()) as {
      threads: { id: string }[]
    }
    expect(legacy.threads.map((t) => t.id)).toEqual(['a', 'b'])

    // 合流先を持たない種別は、これまでどおりその種別だけ。
    const bug = (await (await get(env, '?kind=bug')).json()) as { threads: { id: string }[] }
    expect(bug.threads.map((t) => t.id)).toEqual(['c'])
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

  it('お知らせ（notice）を立てられるのは staff だけ。member は 403（指摘3）', async () => {
    const { env, store } = setup()
    const notice = { ...validInput, kind: 'notice', title: 'メンテナンスの予定' }

    const res = await post(env, notice)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(store.threads.size).toBe(0)

    // 運営なら立てられる。判定は permission.ts の canCreateThread 1 本（種別の表を写さない）。
    store.profiles.set(
      'staff_1',
      fakeProfile({
        user_id: 'staff_1',
        display_name: '運営',
        name_key: 'うんえい',
        role: 'staff',
      }),
    )
    authState.userId = 'staff_1'

    const ok = await post(env, notice)
    expect(ok.status).toBe(201)
    const created = (await ok.json()) as { id: string; seq: number }
    expect(store.threads.get(created.id)).toMatchObject({ kind: 'notice', user_id: 'staff_1' })
    expect(created.seq).toBe(1)
  })

  it('廃止した「目安箱」（suggestion）では新しく立てられない（400 unsupported-kind）', async () => {
    const { env, store } = setup()
    const res = await post(env, { ...validInput, kind: 'suggestion' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unsupported-kind' })
    expect(store.threads.size).toBe(0)

    // 契約（Zod）は今も `suggestion` を通す＝enum から消していない。消すと STG・本番に
    // 残っている目安箱の行が parse で落ち、一覧ごと読めなくなる（CLAUDE.md「後方互換性」）。
    // 止めるのは**新規作成だけ**なので、判断は Zod ではなく canCreateThread が持つ。
    expect(CreateThreadInputSchema.safeParse({ ...validInput, kind: 'suggestion' }).success).toBe(
      true,
    )
  })

  it('本文の上限は BOARD_LIMITS.body（1500 字）。ちょうどは通り、1 字でも超えたら 400', async () => {
    const { env, store } = setup()
    // 下げた値そのものを固定する（BOARD_LIMITS 経由だけだと、うっかり戻しても気づけない）。
    expect(BOARD_LIMITS.body).toBe(1500)

    // 下げる前の上限（4000 字）は、もう通らない。
    expect((await post(env, { ...validInput, body: 'あ'.repeat(4000) })).status).toBe(400)
    expect(
      (await post(env, { ...validInput, body: 'あ'.repeat(BOARD_LIMITS.body + 1) })).status,
    ).toBe(400)
    expect(store.threads.size).toBe(0)

    const res = await post(env, { ...validInput, body: 'あ'.repeat(BOARD_LIMITS.body) })
    expect(res.status).toBe(201)
    const { postId } = (await res.json()) as { postId: string }
    expect(store.posts.get(postId)?.body.length).toBe(BOARD_LIMITS.body)

    // 返信（`functions/api/board/posts.ts`）の入力も同じ上限を見る。片方だけ緩いと
    // 「スレ立てなら弾かれるのに返信なら通る」というちぐはぐが起きる。
    expect(CreatePostInputSchema.safeParse({ body: 'あ'.repeat(BOARD_LIMITS.body) }).success).toBe(
      true,
    )
    expect(
      CreatePostInputSchema.safeParse({ body: 'あ'.repeat(BOARD_LIMITS.body + 1) }).success,
    ).toBe(false)
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

  it('運営は 1 日の上限に数えない（呼び水スレとお知らせを画面から並べられる）', async () => {
    // この上限が守るのは「一人が一覧を埋めない」こと。運営はその心配の相手ではない。
    const { env, store } = setup()
    store.profiles.set('user_1', fakeProfile({ user_id: 'user_1', role: 'staff' }))
    for (let i = 0; i < BOARD_LIMITS.threadsPerDay; i++) {
      store.threads.set(`old${i}`, fakeThread({ id: `old${i}`, created_at: NOW - 1000 }))
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

  it('分あたりの安全弁を使い切っていたら 429（連打を止める枠）', async () => {
    const { env, store } = setup()
    store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: BOARD_ACTIONS_PER_MINUTE,
    })

    const res = await post(env, validInput)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(store.threads.size).toBe(0)
  })

  it('直近 1 時間の投稿が BOARD_LIMITS.postsPerHour 件あればスレも立てられない（D-BOARD-OPEN）', async () => {
    const { env, store } = setup()
    // スレ本文も返信も board_posts の 1 件。返信で枠を使い切った人は、続けてスレも立てられない
    //（種類ごとに枠を分けると「スレなら書ける」抜け道になる）。
    for (let i = 0; i < BOARD_LIMITS.postsPerHour; i++) {
      store.posts.set(
        `old${i}`,
        fakePost({ id: `old${i}`, thread_id: 'other', seq: i + 1, created_at: NOW - 1000 }),
      )
    }

    const res = await post(env, validInput)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'too_many_posts' })
    expect(store.threads.size).toBe(0)
    // 分窓の枠は消費しない（時間枠で断ったリクエストで連打の枠を食わない）。
    expect(store.rates.has('board:user_1')).toBe(false)

    // 1 時間より前の投稿は数えない。
    for (let i = 0; i < BOARD_LIMITS.postsPerHour; i++) {
      store.posts.set(
        `old${i}`,
        fakePost({ id: `old${i}`, thread_id: 'other', seq: i + 1, created_at: NOW - HOUR - 1 }),
      )
    }
    expect((await post(env, validInput)).status).toBe(201)
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

// ---------------------------------------------------------------------------
// 本物の SQLite に当てる（フェイクでは SQL が通るかを確かめられない）
// ---------------------------------------------------------------------------

/**
 * `board-test-util.ts` の D1 フェイクは SQL 文字列の部分一致で分岐するだけなので、
 * 「絞り込みの有無で SQL の形が変わる」経路（`AND t.kind = ?` を付けない一覧）が
 * 本当に実行できるかは見ていない。要望のタブは**その付けないほうの経路**を通るので、
 * ここだけ実 SQLite（`real-d1.ts`）に当てて、SQL が通ることまで確かめる。
 */
describe('GET を本物の SQLite に当てる', () => {
  let d: RealD1

  beforeEach(() => {
    d = makeRealD1()
  })

  afterEach(() => {
    d.close()
  })

  /** 実 D1 ハンドルを差した env（Clerk の鍵はモックが見るだけ）。 */
  const realEnv = () => ({ DB: d.db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' })

  it('要望のタブ（旧目安箱と合流）も、種別なしの一覧も SQL が通る', async () => {
    d.seed.profile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' })
    d.seed.thread({ id: 'a', kind: 'suggestion', title: '目安箱', bumped_at: 1000 })
    d.seed.thread({ id: 'b', kind: 'request', title: '要望', bumped_at: 3000 })
    d.seed.thread({ id: 'c', kind: 'bug', title: '不具合', bumped_at: 5000 })
    d.seed.post({ id: 'pa', thread_id: 'a', seq: 1, body: 'ひとことどうぞ' })
    d.seed.post({ id: 'pb', thread_id: 'b', seq: 1, body: '要望の本文' })
    d.seed.post({ id: 'pc', thread_id: 'c', seq: 1, body: '不具合の本文' })

    const all = await get(realEnv())
    expect(all.status).toBe(200)
    expect(((await all.json()) as { threads: { id: string }[] }).threads.map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ])

    const merged = await get(realEnv(), '?kind=request')
    expect(merged.status).toBe(200)
    const body = (await merged.json()) as { threads: { id: string; excerpt: string }[] }
    expect(body.threads.map((t) => t.id)).toEqual(['b', 'a'])
    // 抜粋も author も JOIN 越しに埋まる（列名が曖昧なら、ここで落ちる）。
    expect(body.threads[1]?.excerpt).toBe('ひとことどうぞ')

    const bug = await get(realEnv(), '?kind=bug')
    expect(((await bug.json()) as { threads: { id: string }[] }).threads.map((t) => t.id)).toEqual([
      'c',
    ])
  })
})

// ---------------------------------------------------------------------------
// 実 SQLite での絞り込み（フェイク D1 は SQL を解釈しないので別に確かめる）
// ---------------------------------------------------------------------------

describe('GET /api/board/threads — 種別の絞り込み（実 SQLite）', () => {
  it('ほかの種別が多くても、要望タブが空にならない（SQL 側で絞る）', async () => {
    // 引いた行を JS で捨てる作りだと、雑談が 1 ページを埋めた時点で要望が 0 件になり、
    // それでも nextCursor が返るので画面が「空なのに『もっと読む』」になる。
    const h = makeRealD1()
    h.seed.profile({ user_id: 'u1', display_name: 'Dende', name_key: 'dende' })
    for (let i = 0; i < 25; i++) {
      h.seed.thread({ id: `c${i}`, kind: 'chat', user_id: 'u1', bumped_at: 2000 + i })
    }
    h.seed.thread({ id: 'r1', kind: 'request', user_id: 'u1', bumped_at: 1000 })
    // 旧目安箱は要望タブに合流する（D-BOARD-KIND）。
    h.seed.thread({ id: 's1', kind: 'suggestion', user_id: 'u1', bumped_at: 900 })

    const res = await (
      onRequestGet as unknown as (c: { request: Request; env: unknown }) => Promise<Response>
    )({
      request: new Request('https://x/api/board/threads?kind=request'),
      env: { DB: h.db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' },
    })
    const payload = (await res.json()) as {
      threads: Array<{ id: string }>
      nextCursor: string | null
    }
    expect(res.status).toBe(200)
    expect(payload.threads.map((t) => t.id).sort()).toEqual(['r1', 's1'])
    expect(payload.nextCursor).toBeNull()
    h.close()
  })
})
