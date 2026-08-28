// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/moderate のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み系は 401
 *   §7-4  **staff は非表示にできるが削除はしない**（member の措置は 403）
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタ（素の user_id）と混ざらない
 *
 * スレの非表示（`hide_thread`）は**実際に `listThreads` / `readThreadDetail` を叩いて**
 * 一覧と詳細から消えることを見る。`hidden_at` が入ったかだけを見ると、タイトルが
 * 残り続ける（この措置を足した理由そのもの）事故を捕まえられない。
 *
 * `ban_user` の `postId` 指定は、**効いたこと**と**レスポンスに user_id が現れないこと**を
 * 対で固定する。前者だけだと、間接指定が user_id の逆引き器に変わっても気づけない。
 *
 * いちばん効かせたいのは**運営に削除の経路が無い**こと。非表示（`hidden_at`）と本人の
 * 削除（`deleted_at`）が同じ列に落ちると、「誰が消したのか」を後から示せなくなる。
 * そこで hide_post のあとに本文・`deleted_at`・行そのものが残ることと、`delete_post` の
 * ような action が入口で 400 になることを両方から固定する。
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'staff_1' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { normalizeUrl, urlKeyOf } from '../../../src/core/board/link'
import { listThreads, readThreadDetail } from '../_lib/board-store'
import {
  type BoardDbFake,
  fakeLink,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestPost } from './moderate'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const post = (env: unknown, body: unknown) =>
  (onRequestPost as unknown as Handler)({
    request: new Request('https://x/api/board/moderate', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

/** 貼られている URL（キャッシュ済み）。正規化して同じ行に当たることも確かめる。 */
const CACHED_URL = 'https://example.com/a'

/**
 * staff_1（運営）・user_1（スレ主）・user_2（返信した人）が居て、`t1` に投稿が 2 件。
 * `board_links` にはカード 1 枚を入れておく。
 */
async function setup(): Promise<{ store: BoardDbFake; env: unknown; urlKey: string }> {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({
        user_id: 'staff_1',
        display_name: '運営',
        name_key: 'うんえい',
        role: 'staff',
      }),
      fakeProfile({ user_id: 'user_1', display_name: 'スレ主', name_key: 'すれぬし' }),
      fakeProfile({ user_id: 'user_2', display_name: '通りすがり', name_key: 'とおりすがり' }),
    ],
    threads: [fakeThread({ id: 't1', kind: 'request', user_id: 'user_1', reply_count: 1 })],
    posts: [
      fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', body: 'スレ本文' }),
      fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2', body: '荒らしの返信' }),
    ],
  })
  const urlKey = await urlKeyOf(normalizeUrl(CACHED_URL) as string)
  store.links.set(urlKey, fakeLink({ url_key: urlKey, url: CACHED_URL }))
  return { store, env: makeBoardEnv({ store }), urlKey }
}

beforeEach(() => {
  authState.userId = 'staff_1'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 入口（認証・入力・権限）
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — 入口', () => {
  it('未ログインは 401（§7-1）。何も変えない', async () => {
    const { store, env } = await setup()
    authState.userId = null

    const res = await post(env, { action: 'hide_post', postId: 'p2' })
    expect(res.status).toBe(401)
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })

  it('member は 403（§7-4）。プロフィール未登録も 403', async () => {
    const { store, env } = await setup()

    authState.userId = 'user_1' // role = 'member'
    expect((await post(env, { action: 'hide_post', postId: 'p2' })).status).toBe(403)

    authState.userId = 'user_9' // board_profiles に行が無い
    expect((await post(env, { action: 'hide_post', postId: 'p2' })).status).toBe(403)

    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })

  it('JSON でない・未知の action・欠けた引数は 400', async () => {
    const { env } = await setup()

    expect((await post(env, 'not json')).status).toBe(400)
    expect((await post(env, { action: 'purge_post', postId: 'p2' })).status).toBe(400)
    expect((await post(env, { action: 'hide_post' })).status).toBe(400)
    expect((await post(env, { action: 'block_link' })).status).toBe(400)

    // 対象を指していないスレの非表示は 400。**投稿の postId では代用させない**
    //（seq=1 を伏せてもタイトルは残る＝別の措置なので、器も別に指させる）。
    const noThread = await post(env, { action: 'hide_thread', postId: 'p1' })
    expect(noThread.status).toBe(400)
    expect(await noThread.json()).toEqual({ error: 'missing_thread' })

    // ban は userId も postId も無ければスキーマ段（refine）で 400。
    expect((await post(env, { action: 'ban_user' })).status).toBe(400)
    expect((await post(env, { action: 'ban_user', bannedUntil: NOW + 1000 })).status).toBe(400)
  })

  it('存在しない投稿・スレ・利用者・URL は 404', async () => {
    const { env } = await setup()

    expect((await post(env, { action: 'hide_post', postId: 'nope' })).status).toBe(404)
    expect((await post(env, { action: 'hide_thread', threadId: 'nope' })).status).toBe(404)
    expect(
      (await post(env, { action: 'ban_user', userId: 'nope', bannedUntil: NOW + 1000 })).status,
    ).toBe(404)
    expect(
      (await post(env, { action: 'ban_user', postId: 'nope', bannedUntil: NOW + 1000 })).status,
    ).toBe(404)
    expect((await post(env, { action: 'block_link', url: 'https://other.example/x' })).status).toBe(
      404,
    )
  })

  it('member はスレの非表示も 403（措置は staff だけ・§7-4）', async () => {
    const { store, env } = await setup()
    authState.userId = 'user_1' // スレ主だが role = 'member'

    const res = await post(env, { action: 'hide_thread', threadId: 't1' })
    expect(res.status).toBe(403)
    expect(store.threads.get('t1')?.hidden_at).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §7-4 — staff は非表示にできるが削除はしない
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — 非表示（削除ではない）', () => {
  it('hide_post は hidden_at を入れるだけ。本文も deleted_at も行も残る（§7-4）', async () => {
    const { store, env } = await setup()

    const res = await post(env, { action: 'hide_post', postId: 'p2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'hide_post',
      postId: 'p2',
      hidden: true,
    })

    const p2 = store.posts.get('p2')
    expect(p2).toBeTruthy()
    expect(p2?.hidden_at).toBe(NOW)
    // 消していない: 本文はそのまま（伏字にするのは読み出し側の visiblePost）。
    expect(p2?.body).toBe('荒らしの返信')
    // 本人の削除と混ざらない。
    expect(p2?.deleted_at).toBe(0)
    // 巻き添えも無い（スレ本文は無傷）。
    expect(store.posts.get('p1')?.hidden_at).toBe(0)
  })

  it('unhide_post で戻せる（措置は可逆）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'hide_post', postId: 'p2' })
    expect(store.posts.get('p2')?.hidden_at).toBe(NOW)

    const res = await post(env, { action: 'unhide_post', postId: 'p2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'unhide_post',
      postId: 'p2',
      hidden: false,
    })
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
    expect(store.posts.get('p2')?.body).toBe('荒らしの返信')
  })

  it('非表示にすると reply_count は数え直される（伏せた投稿は数えない）', async () => {
    const { store, env } = await setup()
    expect(store.threads.get('t1')?.reply_count).toBe(1)

    await post(env, { action: 'hide_post', postId: 'p2' })
    expect(store.threads.get('t1')?.reply_count).toBe(0)

    await post(env, { action: 'unhide_post', postId: 'p2' })
    expect(store.threads.get('t1')?.reply_count).toBe(1)
  })

  it('削除系の action は入口で弾かれ、投稿は 1 件も減らない（§7-4）', async () => {
    const { store, env } = await setup()

    // `hide_thread` はここに置かない。**非表示は運営に許した措置**で、削除ではない
    // （行は残り `unhide_thread` で戻る）。下の「スレの非表示」で別に固定する。
    for (const action of ['delete_post', 'delete_thread', 'purge_user', 'purge_thread']) {
      expect((await post(env, { action, postId: 'p2', userId: 'user_2' })).status).toBe(400)
    }

    expect(store.posts.size).toBe(2)
    expect(store.posts.get('p2')?.deleted_at).toBe(0)
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// スレの非表示（タイトルごと一覧から下ろす）
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — スレの非表示', () => {
  it('hide_thread でスレが一覧にも詳細にも出なくなる（タイトルごと下りる）', async () => {
    const { store, env } = await setup()

    // 前提: 措置の前は一覧にも詳細にも出ている。
    expect((await listThreads(store.db)).rows.map((r) => r.id)).toEqual(['t1'])

    const res = await post(env, { action: 'hide_thread', threadId: 't1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'hide_thread',
      threadId: 't1',
      hidden: true,
    })

    // 一覧（listThreads）から消える＝タイトルが返らない。hide_post では消せなかったところ。
    const list = await listThreads(store.db)
    expect(list.rows).toEqual([])

    // 詳細（readThreadDetail）は行を引いたうえで `hidden_at` を返し、
    // `GET /api/board/thread` はこれを見て 404 にする（thread.ts の GET）。
    const detail = await readThreadDetail(store.db, 't1')
    expect(detail?.thread.hidden_at).toBe(NOW)

    // 措置であって削除ではない: スレも投稿も行のまま、`deleted_at` は 0。
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
    expect(store.threads.get('t1')?.title).toBe('タイトル')
    expect(store.posts.size).toBe(2)
    expect(store.posts.get('p1')?.deleted_at).toBe(0)
    expect(store.posts.get('p2')?.deleted_at).toBe(0)
  })

  it('unhide_thread で一覧にも詳細にも戻る（措置は可逆）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'hide_thread', threadId: 't1' })
    expect((await listThreads(store.db)).rows).toEqual([])

    const res = await post(env, { action: 'unhide_thread', threadId: 't1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'unhide_thread',
      threadId: 't1',
      hidden: false,
    })

    const list = await listThreads(store.db)
    expect(list.rows.map((r) => r.id)).toEqual(['t1'])
    expect(list.rows[0]?.title).toBe('タイトル')
    expect((await readThreadDetail(store.db, 't1'))?.thread.hidden_at).toBe(0)
  })

  it('スレを伏せても投稿ごとの措置は上書きされない（hidden_at は別の列）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'hide_post', postId: 'p2' })
    await post(env, { action: 'hide_thread', threadId: 't1' })
    await post(env, { action: 'unhide_thread', threadId: 't1' })

    // スレを戻しても、個別に伏せた返信は伏せたまま。
    expect(store.posts.get('p2')?.hidden_at).toBe(NOW)
    expect(store.posts.get('p1')?.hidden_at).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 投稿禁止
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — 投稿禁止', () => {
  it('ban_user は期限を入れ、unban_user で 0 に戻す', async () => {
    const { store, env } = await setup()
    const until = NOW + 7 * 24 * 3600 * 1000

    const res = await post(env, { action: 'ban_user', userId: 'user_2', bannedUntil: until })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'ban_user',
      userId: 'user_2',
      bannedUntil: until,
    })
    expect(store.profiles.get('user_2')?.banned_until).toBe(until)
    // 表示名・立場は据え置き（1 欄の更新で他の欄を落とさない）。
    expect(store.profiles.get('user_2')?.display_name).toBe('通りすがり')
    expect(store.profiles.get('user_2')?.role).toBe('member')

    const off = await post(env, { action: 'unban_user', userId: 'user_2' })
    expect(off.status).toBe(200)
    expect(store.profiles.get('user_2')?.banned_until).toBe(0)
  })

  it('禁止しても投稿は消えない（書けなくなるだけ）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'ban_user', userId: 'user_2', bannedUntil: NOW + 1000 })
    expect(store.posts.get('p2')?.body).toBe('荒らしの返信')
    expect(store.posts.get('p2')?.deleted_at).toBe(0)
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })

  it('postId で対象を指せる。**レスポンスに user_id は出さない**', async () => {
    const { store, env } = await setup()
    const until = NOW + 3 * 24 * 3600 * 1000

    const res = await post(env, { action: 'ban_user', postId: 'p2', bannedUntil: until })
    expect(res.status).toBe(200)

    // 効いている: p2 を書いた user_2 が禁止になった。
    expect(store.profiles.get('user_2')?.banned_until).toBe(until)
    expect(store.profiles.get('user_1')?.banned_until).toBe(0)
    expect(store.profiles.get('staff_1')?.banned_until).toBe(0)

    // 返すのは「この投稿の人を止めた」まで。user_id を載せると、投稿 id 1 つから
    // Clerk の user_id を引ける経路になり、どのレスポンスにも user_id を出さない
    // という設計（§5）が moderate だけ穴になる。
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({
      ok: true,
      action: 'ban_user',
      postId: 'p2',
      bannedUntil: until,
    })
    expect(body).not.toContain('user_2')
    expect(body).not.toContain('userId')
  })

  it('postId で指した unban も効く（同じく user_id を返さない）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'ban_user', postId: 'p2', bannedUntil: NOW + 1000 })
    expect(store.profiles.get('user_2')?.banned_until).toBe(NOW + 1000)

    const res = await post(env, { action: 'unban_user', postId: 'p2' })
    expect(res.status).toBe(200)
    expect(store.profiles.get('user_2')?.banned_until).toBe(0)

    const body = await res.text()
    expect(JSON.parse(body)).toEqual({
      ok: true,
      action: 'unban_user',
      postId: 'p2',
      bannedUntil: 0,
    })
    expect(body).not.toContain('user_2')
  })

  it('自分自身は ban できない（400・唯一の staff を締め出さない）', async () => {
    const { store, env } = await setup()

    const res = await post(env, {
      action: 'ban_user',
      userId: 'staff_1',
      bannedUntil: NOW + 1000,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_ban_self' })
    expect(store.profiles.get('staff_1')?.banned_until).toBe(0)
  })

  it('自分の投稿を postId で指しても ban できない（間接指定でも自爆させない）', async () => {
    const { store, env } = await setup()
    store.posts.set(
      'ps',
      fakePost({ id: 'ps', thread_id: 't1', seq: 3, user_id: 'staff_1', body: '運営の返信' }),
    )

    const res = await post(env, { action: 'ban_user', postId: 'ps', bannedUntil: NOW + 1000 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_ban_self' })
    expect(store.profiles.get('staff_1')?.banned_until).toBe(0)
  })

  it('過去・欠けた期限の ban は 400（即座に明ける禁止は打ったことにしない）', async () => {
    const { store, env } = await setup()

    expect(
      (await post(env, { action: 'ban_user', userId: 'user_2', bannedUntil: NOW - 1 })).status,
    ).toBe(400)
    expect(
      (await post(env, { action: 'ban_user', userId: 'user_2', bannedUntil: NOW })).status,
    ).toBe(400)
    expect((await post(env, { action: 'ban_user', userId: 'user_2' })).status).toBe(400)
    expect(store.profiles.get('user_2')?.banned_until).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// リンクカードを潰す
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — block_link', () => {
  it('blocked_at が入るだけで、投稿もリンクの行も残る（設計 §3.2）', async () => {
    const { store, env, urlKey } = await setup()

    const res = await post(env, { action: 'block_link', url: CACHED_URL })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'block_link',
      urlKey,
      url: CACHED_URL,
    })
    expect(store.links.get(urlKey)?.blocked_at).toBe(NOW)
    expect(store.links.get(urlKey)?.title).toBe('タイトル')
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })

  it('正規化してから引く（トラッキングパラメータ・末尾スラッシュ・#断片の違いを吸収）', async () => {
    const { store, env, urlKey } = await setup()

    const res = await post(env, {
      action: 'block_link',
      url: 'https://example.com/a/?utm_source=x#top',
    })
    expect(res.status).toBe(200)
    expect(store.links.get(urlKey)?.blocked_at).toBe(NOW)
  })

  it('URL として読めない・https 以外は 400', async () => {
    const { env } = await setup()

    expect((await post(env, { action: 'block_link', url: 'ぜんぜん URL でない' })).status).toBe(400)
    expect((await post(env, { action: 'block_link', url: 'javascript:alert(1)' })).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// レート制限（§7-11）
// ---------------------------------------------------------------------------

describe('POST /api/board/moderate — レート制限', () => {
  it('カウンタのキーは `board:` 接頭辞で、同期の枠（素の user_id）と混ざらない（§7-11）', async () => {
    const { store, env } = await setup()

    await post(env, { action: 'hide_post', postId: 'p2' })

    expect(store.rates.get('board:staff_1')?.count).toBe(1)
    expect(store.rates.get('staff_1')).toBeUndefined()
  })

  it('枠を使い切ると 429。措置は実行されない', async () => {
    const { store, env } = await setup()
    store.rates.set('board:staff_1', {
      user_id: 'board:staff_1',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: 60,
    })

    const res = await post(env, { action: 'hide_post', postId: 'p2' })
    expect(res.status).toBe(429)
    expect(store.posts.get('p2')?.hidden_at).toBe(0)
  })

  it('403 で弾かれた要求はカウンタを進めない（安い判定を先に済ませる）', async () => {
    const { store, env } = await setup()
    authState.userId = 'user_1'

    expect((await post(env, { action: 'hide_post', postId: 'p2' })).status).toBe(403)
    expect(store.rates.get('board:user_1')).toBeUndefined()
  })
})
