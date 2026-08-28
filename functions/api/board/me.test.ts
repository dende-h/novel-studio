// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/me のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み系は 401（ここは「自分の」情報なので読み取りも 401）
 *   §7-2  表示名が未設定なら、画面が設定ダイアログを出せる形で返る（`profile: null`）
 *   §7-3  予約語・正規化後に重複する表示名は 409
 *   §7-6  削除・非表示の投稿は本文を返さない（伏字を返す）
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタ（素の user_id）と混ざらない
 *
 * いちばん効かせたいのは **Zod を通っただけの名前を保存しない** こと。
 * `ProfileInputSchema` は「空でない 24 文字以内」までしか見ないので、ゼロ幅文字だけの名前も
 * NFKC で伸びて上限を超える名前も素通りする。`validateDisplayName` を必ず挟むことを、
 * 400 と 409 の出方で固定する。
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { nameKeyOf } from '../../../src/core/board/name'
import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '../../../src/core/board/permission'
import { BOARD_LIMITS } from '../../../src/core/board/types'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import type { BoardMeResponse } from './me'
import { onRequestGet, onRequestPut } from './me'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const get = (env: unknown) =>
  (onRequestGet as unknown as Handler)({
    request: new Request('https://x/api/board/me', { headers: { authorization: 'Bearer x' } }),
    env,
  })

/** PUT。`body` に文字列を渡すと、JSON でない本文をそのまま送れる。 */
const put = (env: unknown, body: unknown) =>
  (onRequestPut as unknown as Handler)({
    request: new Request('https://x/api/board/me', {
      method: 'PUT',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

const putName = (env: unknown, displayName: string) => put(env, { displayName })

const bodyOf = async (res: Response): Promise<BoardMeResponse> =>
  (await res.json()) as BoardMeResponse

const errorOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: string }).error

/**
 * user_1（本人・まだ表示名なし）と、名前を 1 つ押さえている user_2 が居る。
 * スレは `t1`（user_2 が立てたもの）。
 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({
        user_id: 'user_2',
        display_name: '通りすがり',
        name_key: nameKeyOf('通りすがり'),
      }),
    ],
    threads: [fakeThread({ id: 't1', kind: 'request', title: '要望スレ', user_id: 'user_2' })],
  })
  return { store, env: makeBoardEnv({ store }) }
}

/** user_1 に表示名を持たせた状態から始めたいとき。 */
function withProfile(store: BoardDbFake, over: Partial<Parameters<typeof fakeProfile>[0]> = {}) {
  store.profiles.set(
    'user_1',
    fakeProfile({
      user_id: 'user_1',
      display_name: 'わたし',
      name_key: nameKeyOf('わたし'),
      created_at: 100,
      updated_at: 100,
      ...over,
    }),
  )
}

beforeEach(() => {
  authState.userId = 'user_1'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// GET — 自分のプロフィールと自分の書き込み
// ---------------------------------------------------------------------------

describe('GET /api/board/me', () => {
  it('未ログインは 401（§7-1）', async () => {
    const { env } = setup()
    authState.userId = null
    expect((await get(env)).status).toBe(401)
  })

  it('表示名が未設定なら profile は null（画面はこれを見て設定ダイアログを出す・§7-2）', async () => {
    const { env } = setup()
    const res = await get(env)
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ profile: null, banned: false, posts: [] })
  })

  it('表示名・staff か・投稿禁止の期限を返す', async () => {
    const { store, env } = setup()
    withProfile(store, { role: 'staff', banned_until: 0 })

    const body = await bodyOf(await get(env))
    expect(body.profile).toEqual({
      userId: 'user_1',
      displayName: 'わたし',
      role: 'staff',
      bannedUntil: 0,
      deletedAt: 0,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(body.banned).toBe(false)
  })

  it('投稿禁止の期限が未来なら banned が立ち、期限ちょうどでは明けている', async () => {
    const { store, env } = setup()

    withProfile(store, { banned_until: NOW + 1 })
    expect((await bodyOf(await get(env))).banned).toBe(true)

    withProfile(store, { banned_until: NOW })
    expect((await bodyOf(await get(env))).banned).toBe(false)
  })

  it('自分の投稿だけを新しい順に返す（他人のは混ざらない）', async () => {
    const { store, env } = setup()
    withProfile(store)
    store.posts.set(
      'p1',
      fakePost({
        id: 'p1',
        thread_id: 't1',
        seq: 2,
        user_id: 'user_1',
        body: '古い返信',
        created_at: 200,
      }),
    )
    store.posts.set(
      'p2',
      fakePost({
        id: 'p2',
        thread_id: 't1',
        seq: 3,
        user_id: 'user_1',
        body: '新しい返信',
        created_at: 300,
      }),
    )
    store.posts.set(
      'p3',
      fakePost({
        id: 'p3',
        thread_id: 't1',
        seq: 1,
        user_id: 'user_2',
        body: '他人の投稿',
        created_at: 400,
      }),
    )

    const { posts } = await bodyOf(await get(env))
    expect(posts.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(posts[0]).toEqual({
      id: 'p2',
      threadId: 't1',
      threadTitle: '要望スレ',
      threadKind: 'request',
      seq: 3,
      excerpt: '新しい返信',
      replyTo: 0,
      deleted: false,
      hidden: false,
      createdAt: 300,
    })
  })

  it('削除・非表示の投稿は本文を返さず伏字にする（§7-6）', async () => {
    const { store, env } = setup()
    withProfile(store)
    store.posts.set(
      'p1',
      fakePost({
        id: 'p1',
        seq: 2,
        user_id: 'user_1',
        body: '消した本文',
        created_at: 200,
        deleted_at: 250,
      }),
    )
    store.posts.set(
      'p2',
      fakePost({
        id: 'p2',
        seq: 3,
        user_id: 'user_1',
        body: '伏せられた本文',
        created_at: 300,
        hidden_at: 350,
      }),
    )

    const { posts } = await bodyOf(await get(env))
    const excerpts = posts.map((p) => p.excerpt).join('\n')
    expect(posts.find((p) => p.id === 'p1')).toMatchObject({
      deleted: true,
      excerpt: DELETED_BODY_TEXT,
    })
    expect(posts.find((p) => p.id === 'p2')).toMatchObject({
      hidden: true,
      excerpt: HIDDEN_BODY_TEXT,
    })
    expect(excerpts).not.toContain('消した本文')
    expect(excerpts).not.toContain('伏せられた本文')
  })

  it('長い本文は抜粋に落とし、スレ行が引けなくても落ちない', async () => {
    const { store, env } = setup()
    withProfile(store)
    const long = 'あ'.repeat(BOARD_LIMITS.excerpt + 50)
    store.posts.set(
      'p1',
      fakePost({ id: 'p1', thread_id: 'gone', seq: 2, user_id: 'user_1', body: long }),
    )

    const [post] = (await bodyOf(await get(env))).posts
    expect([...post.excerpt].length).toBe(BOARD_LIMITS.excerpt + 1) // 抜粋 ＋ 末尾の「…」
    expect(post.excerpt.endsWith('…')).toBe(true)
    expect(post).toMatchObject({ threadTitle: '', threadKind: '' })
  })

  it('読み取りではレート制限のカウンタを進めない', async () => {
    const { store, env } = setup()
    withProfile(store)
    await get(env)
    expect(store.rates.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PUT — 入口（認証と入力の形）
// ---------------------------------------------------------------------------

describe('PUT /api/board/me — 入口', () => {
  it('未ログインは 401。行も作らない（§7-1）', async () => {
    const { store, env } = setup()
    authState.userId = null
    expect((await putName(env, 'あたらしい名前')).status).toBe(401)
    expect(store.profiles.has('user_1')).toBe(false)
  })

  it('JSON でない本文・displayName が無い・型違いは 400', async () => {
    const { env } = setup()
    expect((await put(env, 'not json')).status).toBe(400)
    expect((await put(env, {})).status).toBe(400)
    expect((await put(env, { displayName: 42 })).status).toBe(400)
    expect((await put(env, { displayName: '   ' })).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PUT — 表示名の検証（§7-3）
// ---------------------------------------------------------------------------

describe('PUT /api/board/me — 表示名の検証', () => {
  it('Zod を通っても、正規化して空になる名前は 400 empty', async () => {
    const { store, env } = setup()
    // ゼロ幅スペースは JS の trim() では落ちないので Zod の min(1) を通り抜ける。
    const res = await putName(env, '​​​')
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('empty')
    expect(store.profiles.has('user_1')).toBe(false)
  })

  it('NFKC で伸びて上限を超える名前は 400 too_long', async () => {
    const { env } = setup()
    // '㍿' は 1 文字だが NFKC で '株式会社'（4 文字）に開く。7 文字なら 28 文字。
    const res = await putName(env, '㍿'.repeat(7))
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('too_long')
  })

  it('鍵が空になる名前（記号・長音だけ）は 400 invalid', async () => {
    const { env } = setup()
    const res = await putName(env, '－ー・')
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('invalid')
  })

  it('予約語は 409 reserved。全角・大文字でも同じ鍵に畳んで弾く（§7-3）', async () => {
    const { store, env } = setup()
    for (const name of ['運営', 'ＡＤＭＩＮ', 'コ ト ノ ハ']) {
      const res = await putName(env, name)
      expect(res.status).toBe(409)
      expect(await errorOf(res)).toBe('reserved')
    }
    expect(store.profiles.has('user_1')).toBe(false)
  })

  it('他人が使っている名前は 409 duplicate。見た目が同じ別表記でも取れない（§7-3）', async () => {
    const { store, env } = setup()
    for (const name of ['通りすがり', '通り すがり', '通り・すがり']) {
      const res = await putName(env, name)
      expect(res.status).toBe(409)
      expect(await errorOf(res)).toBe('duplicate')
    }
    expect(store.profiles.has('user_1')).toBe(false)
    expect(store.profiles.get('user_2')?.display_name).toBe('通りすがり')
  })

  it('自分がすでに使っている名前を送り直すのは重複ではない', async () => {
    const { store, env } = setup()
    withProfile(store)
    const res = await putName(env, 'わたし')
    expect(res.status).toBe(200)
    expect(store.profiles.get('user_1')?.display_name).toBe('わたし')
  })
})

// ---------------------------------------------------------------------------
// PUT — 保存
// ---------------------------------------------------------------------------

describe('PUT /api/board/me — 保存', () => {
  it('初回登録は 201 で、正規化した名前と nameKeyOf の鍵が入る', async () => {
    const { store, env } = setup()

    const res = await putName(env, '  あたらしい　名前  ')
    expect(res.status).toBe(201)

    const row = store.profiles.get('user_1')
    // NFKC で全角空白は半角へ、前後の空白は落ちる。
    expect(row?.display_name).toBe('あたらしい 名前')
    expect(row?.name_key).toBe(nameKeyOf('あたらしい 名前'))
    expect(row?.created_at).toBe(NOW)
    expect(row?.updated_at).toBe(NOW)

    // 返す形は GET と同じ（画面が同じ描画を使える）。
    const body = await bodyOf(res)
    expect(body.profile).toMatchObject({ displayName: 'あたらしい 名前', role: 'member' })
    expect(body.posts).toEqual([])
  })

  it('改名は 200。role・banned_until・deleted_at・created_at は据え置く', async () => {
    const { store, env } = setup()
    withProfile(store, { role: 'staff', deleted_at: 0, created_at: 100 })

    const res = await putName(env, 'あらため')
    expect(res.status).toBe(200)
    expect(store.profiles.get('user_1')).toMatchObject({
      display_name: 'あらため',
      name_key: nameKeyOf('あらため'),
      role: 'staff',
      banned_until: 0,
      deleted_at: 0,
      created_at: 100,
      updated_at: NOW,
    })
  })

  it('改名しても過去の投稿は現在の表示名で読める（非正規化しない・D-BOARD-NAME）', async () => {
    const { store, env } = setup()
    withProfile(store)
    store.posts.set('p1', fakePost({ id: 'p1', seq: 2, user_id: 'user_1', body: '古い投稿' }))

    await putName(env, 'あらため')
    const body = await bodyOf(await get(env))
    expect(body.profile?.displayName).toBe('あらため')
    expect(body.posts.map((p) => p.id)).toEqual(['p1'])
  })

  it('投稿禁止中は改名できない（403・期限を添える）', async () => {
    const { store, env } = setup()
    withProfile(store, { banned_until: NOW + 60_000 })

    const res = await putName(env, 'あらため')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned', bannedUntil: NOW + 60_000 })
    expect(store.profiles.get('user_1')?.display_name).toBe('わたし')
  })

  it('UNIQUE(name_key) が弾いた同時登録も 409 duplicate に畳む', async () => {
    const { store } = setup()
    // 事前 SELECT にだけ「誰も使っていない」と答えさせる＝2 人が同時に同じ名前を出した状態。
    const env = { ...makeBoardEnv({ store }), DB: skipNameKeyPreCheck(store.db) }

    const res = await putName(env, '通りすがり')
    expect(res.status).toBe(409)
    expect(await errorOf(res)).toBe('duplicate')
    expect(store.profiles.has('user_1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// レート制限（§7-11）
// ---------------------------------------------------------------------------

describe('PUT /api/board/me — レート制限', () => {
  it('キーは board: 接頭辞で、同期のカウンタ（素の user_id）と混ざらない（§7-11）', async () => {
    const { store, env } = setup()
    await putName(env, 'あたらしい名前')

    expect(store.rates.get('board:user_1')).toEqual({
      user_id: 'board:user_1',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: 1,
    })
    expect(store.rates.has('user_1')).toBe(false)
  })

  it('上限を超えたら 429。弾かれた回では名前を書き換えない', async () => {
    const { store, env } = setup()
    for (let i = 0; i < BOARD_LIMITS.postsPerHour; i++) {
      expect((await putName(env, `名前${i}`)).status).toBeLessThan(400)
    }
    const res = await putName(env, 'これは通らない')
    expect(res.status).toBe(429)
    expect(store.profiles.get('user_1')?.display_name).toBe(`名前${BOARD_LIMITS.postsPerHour - 1}`)
  })

  it('弾かれる入力（予約語）ではカウンタを進めない', async () => {
    const { store, env } = setup()
    await putName(env, '運営')
    expect(store.rates.size).toBe(0)
  })
})

/**
 * `upsertProfile` の事前 SELECT（`WHERE name_key = ?`）にだけ null を返す D1 の皮。
 * 実運用では起きにくいが構造的にありえる「事前 SELECT と INSERT の間に別の人が同じ名前を
 * 取る」を再現し、UNIQUE 制約からの例外も 409 になることを確かめるために使う。
 */
function skipNameKeyPreCheck(db: D1Database): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql)
      if (!sql.includes('FROM board_profiles WHERE name_key = ?')) return stmt
      const shim = {
        bind: (...args: unknown[]) => {
          stmt.bind(...args)
          return shim
        },
        first: async () => null,
      }
      return shim
    },
  } as unknown as D1Database
}
