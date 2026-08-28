// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/reports のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み系は 401
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタ（素の user_id）と混ざらない
 *
 * いちばん効かせたいのは **D-BOARD-REPORT の 2 つ**：
 *   1. 何件通報が積まれても投稿は自動で消えない・隠れない（結託通報で正常な投稿を落とせない）
 *   2. 通報者と件数をレスポンスに出さない（出せると「何件で消えるか」を試す遊びが始まる）
 * どちらも「うっかり足す」ほうへ壊れる種類の規則なので、行の状態とレスポンスの中身の
 * 両方を突き合わせて固定する。
 *
 * 重複（同一 post_id × user_id は 1 件）は 2 通りで確かめる。
 *   * フェイク D1 は id が同じなら同じ行を上書きする＝**行が増えない**ことを見る。
 *   * 実 D1 は主キーの UNIQUE 違反を投げる＝**投げられても 200 で、元の行が残る**ことを、
 *     その振る舞いを足したラッパ（uniqueFailingDb）で見る。
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_2' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { BOARD_LIMITS } from '../../../src/core/board/types'
import type { ReportRow } from '../_lib/board-store'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestPost } from './reports'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

/** 本文は「JSON にならない文字列」も渡せるよう、string でそのまま送る。 */
const report = (env: unknown, body: unknown) =>
  (onRequestPost as unknown as Handler)({
    request: new Request('https://x/api/board/reports', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

const ok = (env: unknown, postId = 'p2', reason = '宣伝が延々と貼られています') =>
  report(env, { postId, reason })

const rows = (store: BoardDbFake): ReportRow[] => [...store.reports.values()]

/**
 * スレ `t1`（本文 p1・返信 p2）に、user_1 が書き、user_2 / user_3 が居る。
 * 通報するのは既定で user_2、対象は返信 p2。
 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({ user_id: 'user_1', display_name: 'スレ主', name_key: 'すれぬし' }),
      fakeProfile({ user_id: 'user_2', display_name: '通りすがり', name_key: 'とおりすがり' }),
      fakeProfile({ user_id: 'user_3', display_name: 'もう一人', name_key: 'もうひとり' }),
    ],
    threads: [fakeThread({ id: 't1', kind: 'chat', user_id: 'user_1', bumped_at: 5000 })],
    posts: [
      fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', body: 'スレ本文' }),
      fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_3', body: '返信' }),
    ],
  })
  return { store, env: makeBoardEnv({ store }) }
}

/**
 * 実 D1 の主キーを再現するラッパ。フェイクは同じ id を上書きするだけなので、
 * 「2 度目は UNIQUE 違反で落ちる」というほんものの振る舞いをここで足す。
 * D1 フェイクの `as unknown as D1Database` は既存の流儀どおり。
 */
function uniqueFailingDb(store: BoardDbFake): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = store.db.prepare(sql)
      if (!sql.trimStart().startsWith('INSERT INTO board_reports')) return stmt
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (store.reports.has(args[0] as string)) {
              throw new Error('D1_ERROR: UNIQUE constraint failed: board_reports.id')
            }
            return await stmt.bind(...args).run()
          },
        }),
      }
    },
  } as unknown as D1Database
}

beforeEach(() => {
  authState.userId = 'user_2'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 入口（認証・入力・対象の存在）
// ---------------------------------------------------------------------------

describe('POST /api/board/reports — 入口', () => {
  it('未ログインは 401（§7-1）。キューに積まない', async () => {
    const { store, env } = setup()
    authState.userId = null

    const res = await ok(env)
    expect(res.status).toBe(401)
    expect(store.reports.size).toBe(0)
  })

  it('JSON でない本文は 400', async () => {
    const { store, env } = setup()
    expect((await report(env, 'not json')).status).toBe(400)
    expect(store.reports.size).toBe(0)
  })

  it.each([
    ['postId が無い', { reason: '理由' }],
    ['postId が空', { postId: '', reason: '理由' }],
    ['reason が無い', { postId: 'p2' }],
    ['reason が空白だけ', { postId: 'p2', reason: '   ' }],
    ['reason が上限超え', { postId: 'p2', reason: 'あ'.repeat(BOARD_LIMITS.reportReason + 1) }],
  ])('%s は 400（ReportInputSchema で弾く）', async (_name, body) => {
    const { store, env } = setup()
    expect((await report(env, body)).status).toBe(400)
    expect(store.reports.size).toBe(0)
  })

  it('存在しない post_id は 404。キューに積まない', async () => {
    const { store, env } = setup()

    const res = await ok(env, 'nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(store.reports.size).toBe(0)
  })

  it('表示名（board_profiles）が無くても通報できる — 通報は記名で表に出ない', async () => {
    const { store, env } = setup()
    authState.userId = 'user_9' // プロフィール未登録

    expect((await ok(env)).status).toBe(200)
    expect(rows(store)[0]?.user_id).toBe('user_9')
  })
})

// ---------------------------------------------------------------------------
// 積むだけ（D-BOARD-REPORT）
// ---------------------------------------------------------------------------

describe('POST /api/board/reports — 作業キューに積む', () => {
  it('未処理（handled_at = 0）の行を 1 件積み、入口の時刻を created_at にする', async () => {
    const { store, env } = setup()

    const res = await ok(env, 'p2', '同じ宣伝を連投しています')
    expect(res.status).toBe(200)
    expect(store.reports.size).toBe(1)
    expect(rows(store)[0]).toMatchObject({
      post_id: 'p2',
      user_id: 'user_2',
      reason: '同じ宣伝を連投しています',
      created_at: NOW,
      handled_at: 0,
    })
  })

  it('スレ本文（seq=1）も通報できる — 本文と返信で経路を分けない（§4）', async () => {
    const { store, env } = setup()
    expect((await ok(env, 'p1')).status).toBe(200)
    expect(rows(store)[0]?.post_id).toBe('p1')
  })

  it('削除済み・運営が非表示にした投稿も通報できる（行は残っていて措置はまだ打てる）', async () => {
    const { store, env } = setup()
    store.posts.set('p2', fakePost({ id: 'p2', thread_id: 't1', seq: 2, deleted_at: NOW - 1 }))
    expect((await ok(env)).status).toBe(200)

    store.posts.set('p2', fakePost({ id: 'p2', thread_id: 't1', seq: 2, hidden_at: NOW - 1 }))
    authState.userId = 'user_3'
    expect((await ok(env)).status).toBe(200)
    expect(store.reports.size).toBe(2)
  })

  it('自分の投稿も通報できる（誤爆の取り下げはここの仕事ではない）', async () => {
    const { store, env } = setup()
    authState.userId = 'user_3' // p2 の投稿者
    expect((await ok(env)).status).toBe(200)
    expect(store.reports.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 自動非表示をしない（D-BOARD-REPORT の要）
// ---------------------------------------------------------------------------

describe('POST /api/board/reports — 件数では何も起きない', () => {
  it('別々の 3 人が同じ投稿を通報しても、投稿もスレも一切変わらない', async () => {
    const { store, env } = setup()
    const postBefore = { ...store.posts.get('p2') }
    const threadBefore = { ...store.threads.get('t1') }

    for (const userId of ['user_1', 'user_2', 'user_3']) {
      authState.userId = userId
      expect((await ok(env)).status).toBe(200)
    }

    // 3 件のキューが積まれただけ。非表示（hidden_at）も削除（deleted_at）も付かない。
    expect(store.reports.size).toBe(3)
    expect(store.posts.get('p2')).toEqual(postBefore)
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
    // スレも持ち上がらない（一覧の並びは最終書き込み順・§2）。
    expect(store.threads.get('t1')).toEqual(threadBefore)
    expect(store.threads.get('t1')?.bumped_at).toBe(5000)
    // 投稿禁止も打たれない（それは運営が手で打つ moderate の仕事）。
    expect(store.profiles.get('user_3')?.banned_until).toBe(0)
  })

  it('レスポンスに件数も通報者も入れない', async () => {
    const { store, env } = setup()
    await ok(env)
    authState.userId = 'user_3'

    const res = await ok(env)
    const text = await res.text()
    expect(text).toBe(JSON.stringify({ ok: true }))
    // 件数（2）も通報者の user_id も、行 id も漏れない。
    expect(text).not.toContain('user_')
    expect(text).not.toContain(rows(store)[0]?.id ?? '@')
  })
})

// ---------------------------------------------------------------------------
// 重複（同一 post_id × user_id は 1 件）
// ---------------------------------------------------------------------------

describe('POST /api/board/reports — 同じ人の重ねての通報', () => {
  it('同じ人が同じ投稿を 3 回通報しても行は 1 件のまま（毎回 200）', async () => {
    const { store, env } = setup()

    for (let i = 0; i < 3; i++) expect((await ok(env)).status).toBe(200)
    expect(store.reports.size).toBe(1)
  })

  it('実 D1 の UNIQUE 違反でも 200 を返し、最初の行（理由・created_at）を残す', async () => {
    const { store } = setup()
    const env = makeBoardEnv({ store })
    ;(env as { DB: D1Database }).DB = uniqueFailingDb(store)

    expect((await ok(env, 'p2', '最初の理由')).status).toBe(200)

    vi.setSystemTime(NOW + 60_000)
    const res = await ok(env, 'p2', 'あとから書き換えた理由')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // 処理済みの通報が再通報で未処理に戻らないよう、既存行は触らない。
    expect(store.reports.size).toBe(1)
    expect(rows(store)[0]).toMatchObject({ reason: '最初の理由', created_at: NOW, handled_at: 0 })
  })

  it('別の人の通報・別の投稿への通報は、それぞれ独立して積まれる', async () => {
    const { store, env } = setup()

    await ok(env, 'p2') // user_2 → p2
    await ok(env, 'p1') // user_2 → p1
    authState.userId = 'user_3'
    await ok(env, 'p2') // user_3 → p2

    expect(store.reports.size).toBe(3)
    // 行 id は (post_id, user_id) から決まるので、3 件とも別の id になる。
    expect(new Set(rows(store).map((r) => r.id)).size).toBe(3)
  })

  it('行 id は通報者の user_id をそのまま含まない（キューの id が通報者の名簿にならない）', async () => {
    const { store, env } = setup()
    await ok(env)

    const id = rows(store)[0]?.id ?? ''
    expect(id).not.toContain('user_2')
    expect(id).not.toContain('p2')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// レート制限（D-BOARD-RATE・§7-11）
// ---------------------------------------------------------------------------

describe('POST /api/board/reports — レート制限', () => {
  it('`board:` 接頭辞のキーで数える（同期の枠と混ざらない・§7-11）', async () => {
    const { store, env } = setup()

    await ok(env)
    expect(store.rates.has('board:user_2')).toBe(true)
    expect(store.rates.has('user_2')).toBe(false)
  })

  it('分窓の上限を超えたら 429（超過ぶんは積まない）', async () => {
    const { store, env } = setup()
    store.rates.set('board:user_2', {
      user_id: 'board:user_2',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: BOARD_LIMITS.postsPerHour,
    })

    const res = await ok(env)
    expect(res.status).toBe(429)
    expect(store.reports.size).toBe(0)
  })

  it('弾かれるリクエスト（存在しない投稿）ではカウンタを進めない', async () => {
    const { store, env } = setup()

    expect((await ok(env, 'nope')).status).toBe(404)
    expect(store.rates.has('board:user_2')).toBe(false)
  })
})
