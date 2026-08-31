// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * board-store の SQL を**本物の SQLite**（`functions/api/board/real-d1.ts`）に当てる。
 *
 * `board-store.test.ts` が使う D1 フェイクは SQL 文字列の部分一致で分岐して固定の行を返すだけで、
 * SQL を解釈しない。だから「構文が通るか」「列名が曖昧でないか」「型が合うか」は永久に検出できず、
 * `readThreadDetail` の `ambiguous column name: url_key` は STG で 500 になるまで誰も気づけなかった。
 * このファイルの主目的は**結果の正しさではなく、SQL が実際に実行できること**。
 * そのうえで、返る行の形（列名が snake_case で揃っているか・`to*` が壊れずに変換できるか）も見る。
 *
 * 決めごと:
 *   * **board-store の export は 1 つ残らずここで実行する。** 呼び忘れが穴になるので、
 *     最後の `it` が「未実行の export が無いこと」を機械で確かめる（`called` の記録）。
 *   * 結合する SELECT は**結合先に行がある状態**で叩く。空振りすると列名の曖昧さに気づけない
 *     （board_post_links に 1 行も無いまま叩いていたのが、今回の見逃しの原因）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeRealD1, type RealD1 } from '../board/real-d1'
import type { LinkRow } from './board-store'
import * as boardStore from './board-store'

// ---------------------------------------------------------------------------
// export の実行漏れを機械で見張る
// ---------------------------------------------------------------------------

/**
 * 呼ばれた export の名前。`S.foo(...)` 経由で呼ぶと記録される。
 * テストは必ずこの `S` から呼ぶこと（素の `boardStore` を直に使うと記録が漏れる）。
 */
const called = new Set<string>()

const S = new Proxy(boardStore, {
  get(target, key) {
    const value = Reflect.get(target, key) as unknown
    if (typeof key !== 'string' || typeof value !== 'function') return value
    const fn = value as (...args: unknown[]) => unknown
    return (...args: unknown[]) => {
      called.add(key)
      return fn(...args)
    }
  },
}) as typeof boardStore

/** `null` を弾いて中身を取り出す（非 null 表明を書かずに済ませる）。 */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} が無い`)
  return value
}

let d: RealD1

beforeEach(() => {
  d = makeRealD1()
})

afterEach(() => {
  d.close()
})

// ---------------------------------------------------------------------------
// プロフィール
// ---------------------------------------------------------------------------

describe('プロフィール', () => {
  it('登録・改名・重複・投稿禁止・退会が実 SQL で通る', async () => {
    expect(await S.readProfile(d.db, 'user_1')).toBeNull()

    expect(
      await S.upsertProfile(d.db, {
        userId: 'user_1',
        displayName: 'あかり',
        nameKey: 'あかり',
        now: 1000,
      }),
    ).toEqual({ ok: true })

    const first = must(await S.readProfile(d.db, 'user_1'), 'プロフィール')
    expect(first.display_name).toBe('あかり')
    // INSERT の既定値（member / 0 / 0）がマイグレーション通りに入る
    expect(first.role).toBe('member')
    expect(first.banned_until).toBe(0)

    // 改名＝ON CONFLICT(user_id) DO UPDATE の経路
    expect(
      await S.upsertProfile(d.db, {
        userId: 'user_1',
        displayName: 'あかり改',
        nameKey: 'あかりかい',
        now: 2000,
      }),
    ).toEqual({ ok: true })
    expect(must(await S.readProfile(d.db, 'user_1'), 'プロフィール').name_key).toBe('あかりかい')

    // 他人が同じ name_key を取ろうとすると duplicate（事前 SELECT で弾く）
    expect(
      await S.upsertProfile(d.db, {
        userId: 'user_2',
        displayName: 'あかり改',
        nameKey: 'あかりかい',
        now: 3000,
      }),
    ).toEqual({ ok: false, reason: 'duplicate' })

    // 事前 SELECT をすり抜けた同時登録を受け止める UNIQUE(name_key) が実在すること。
    // 索引が無いと upsertProfile の catch は永久に到達せず、重複した名前が通る。
    expect(() => d.seed.profile({ user_id: 'user_9', name_key: 'あかりかい' })).toThrow()

    await S.setBan(d.db, 'user_1', 5000, 4000)
    await S.markProfileDeleted(d.db, 'user_1', 6000)

    const after = must(await S.readProfile(d.db, 'user_1'), 'プロフィール')
    expect(S.toProfile(after)).toEqual({
      userId: 'user_1',
      displayName: 'あかり改',
      role: 'member',
      bannedUntil: 5000,
      deletedAt: 6000,
      createdAt: 1000,
      updatedAt: 6000,
    })
  })
})

// ---------------------------------------------------------------------------
// スレ一覧
// ---------------------------------------------------------------------------

describe('listThreads', () => {
  beforeEach(() => {
    d.seed.profile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' })
    d.seed.thread({ id: 't1', kind: 'request', bumped_at: 1000, pinned: 0 })
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, body: '本文1' })
    d.seed.thread({ id: 't2', kind: 'bug', bumped_at: 2000, pinned: 0 })
    d.seed.post({ id: 'p2', thread_id: 't2', seq: 1, body: '本文2' })
    d.seed.thread({ id: 't3', kind: 'request', bumped_at: 3000, pinned: 1 })
    d.seed.post({ id: 'p3', thread_id: 't3', seq: 1, body: '本文3' })
    // 削除・非表示は一覧に出さない（見出しも出さない）
    d.seed.thread({ id: 't4', kind: 'chat', bumped_at: 9000, deleted_at: 8000 })
    d.seed.thread({ id: 't5', kind: 'chat', bumped_at: 9000, hidden_at: 8000 })
    d.seed.poll({ thread_id: 't1' })
    // 一覧の `liked` は**スレ本文（seq=1）への 👍**（0009）。押す相手は投稿。
    d.seed.like({ post_id: 'p1', user_id: 'user_1' })
  })

  it('絞り込みなし（ピン留め → 最終書き込みの新しい順）', async () => {
    const res = await S.listThreads(d.db, { viewerId: 'user_1' })
    expect(res.rows.map((r) => r.id)).toEqual(['t3', 't2', 't1'])
    expect(res.nextCursor).toBeNull()

    const t1 = must(
      res.rows.find((r) => r.id === 't1'),
      't1 の行',
    )
    // 相関サブクエリと LEFT JOIN の列が期待どおりの名前で返る
    expect(t1.has_poll).toBe(1)
    expect(t1.liked).toBe(1)
    expect(t1.head_body).toBe('本文1')
    expect(t1.author_name).toBe('あかり')
    expect(t1.author_deleted).toBe(0)

    const thread = S.toThread(t1, 'user_1')
    expect(thread.excerpt).toBe('本文1')
    expect(thread.hasPoll).toBe(true)
    expect(thread.liked).toBe(true)
    expect(thread.mine).toBe(true)
    expect(thread.author.displayName).toBe('あかり')
  })

  it('未ログイン（viewerId が null）でも SQL が通り、👍 は 0 になる', async () => {
    const res = await S.listThreads(d.db, {})
    expect(res.rows.map((r) => r.id)).toEqual(['t3', 't2', 't1'])
    expect(res.rows.every((r) => r.liked === 0)).toBe(true)
  })

  it('kind 指定', async () => {
    const res = await S.listThreads(d.db, { kind: 'request', viewerId: 'user_1' })
    expect(res.rows.map((r) => r.id)).toEqual(['t3', 't1'])
  })

  it('cursor 指定（pinned・bumped_at・id の 3 つ組で続きを読む）', async () => {
    const page1 = await S.listThreads(d.db, { limit: 1, viewerId: 'user_1' })
    expect(page1.rows.map((r) => r.id)).toEqual(['t3'])
    expect(page1.nextCursor).toBe('1:3000:t3')

    const page2 = await S.listThreads(d.db, { limit: 1, cursor: page1.nextCursor })
    expect(page2.rows.map((r) => r.id)).toEqual(['t2'])

    const page3 = await S.listThreads(d.db, { limit: 5, cursor: page2.nextCursor })
    expect(page3.rows.map((r) => r.id)).toEqual(['t1'])
    expect(page3.nextCursor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// スレの読み書き
// ---------------------------------------------------------------------------

describe('readThreadDetail', () => {
  beforeEach(() => {
    d.seed.profile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' })
    d.seed.profile({ user_id: 'user_2', display_name: 'ほたる', name_key: 'ほたる', role: 'staff' })
    d.seed.thread({ id: 't1', user_id: 'user_1', kind: 'request' })
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', body: '本文' })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2', body: '返信' })
    d.seed.link({
      url_key: 'k1',
      url: 'https://example.com/1',
      image_ok: 1,
      image_url: 'https://i/1',
    })
    d.seed.link({ url_key: 'k2', url: 'https://example.com/2' })
    // **リンクが実際に付いた投稿**を作る。ここが空だと結合が空振りして
    // 列名の曖昧さ（board_post_links と board_links の url_key）に気づけない。
    d.seed.postLink({ post_id: 'p1', url_key: 'k1', ord: 0 })
    d.seed.postLink({ post_id: 'p1', url_key: 'k2', ord: 1 })
    d.seed.postLink({ post_id: 'p2', url_key: 'k1', ord: 0 })
    d.seed.poll({ thread_id: 't1', question: 'どちらが良い？' })
    d.seed.vote({ thread_id: 't1', user_id: 'user_1', choices: JSON.stringify([0]) })
    d.seed.vote({ thread_id: 't1', user_id: 'user_2', choices: JSON.stringify([1]) })
  })

  it('6 本の batch がすべて実行でき、リンク付きの投稿まで組み立てられる', async () => {
    const detail = must(await S.readThreadDetail(d.db, 't1', 'user_1'), '詳細')

    expect(detail.thread.id).toBe('t1')
    expect(detail.thread.author_name).toBe('あかり')
    expect(detail.posts.map((p) => p.seq)).toEqual([1, 2])
    expect(detail.posts.map((p) => p.author_name)).toEqual(['あかり', 'ほたる'])
    expect(detail.poll?.question).toBe('どちらが良い？')
    expect(detail.myVote?.user_id).toBe('user_1')
    expect(detail.votes).toHaveLength(2)

    // 結合した board_links の列が `l.` 側の値で揃って返る
    const p1Links = must(detail.links.get('p1'), 'p1 のリンク')
    expect(p1Links.map((l) => l.url_key)).toEqual(['k1', 'k2'])
    expect(p1Links.map((l) => l.url)).toEqual(['https://example.com/1', 'https://example.com/2'])
    expect(must(detail.links.get('p2'), 'p2 のリンク')).toHaveLength(1)

    const post = S.toPost(must(detail.posts[0], '1 番目の投稿'), {
      viewerId: 'user_1',
      links: p1Links,
    })
    expect(post.body).toBe('本文')
    expect(post.mine).toBe(true)
    expect(post.links.map((c) => c.url)).toEqual(['https://example.com/1', 'https://example.com/2'])
    // image_ok=1 の行だけ画像を残す
    expect(post.links.map((c) => c.imageUrl)).toEqual(['https://i/1', ''])

    expect(S.toPoll(must(detail.poll, 'アンケート')).options).toEqual(['A', 'B'])
    expect(S.toVote(must(detail.myVote, '自分の票')).choices).toEqual([0])
    expect(S.toAuthor(must(detail.posts[1], '2 番目の投稿')).staff).toBe(true)
    expect(S.toLinkCard(must(p1Links[0], 'リンク行')).host).toBe('example.com')
    expect(S.toLinkCards(p1Links)).toHaveLength(2)
  })

  it('未ログイン（viewerId が null）でも 6 本すべて実行できる', async () => {
    const detail = must(await S.readThreadDetail(d.db, 't1', null), '詳細')
    expect(detail.myVote).toBeNull()
    expect(detail.thread.liked).toBe(0)
    expect(detail.votes).toHaveLength(2)
  })

  it('無いスレは null', async () => {
    expect(await S.readThreadDetail(d.db, 'no-such', 'user_1')).toBeNull()
  })
})

describe('スレの作成・更新・削除', () => {
  it('createThread / readThread / patchThread / bumpThread / hideThread', async () => {
    await S.createThread(d.db, {
      id: 't1',
      kind: 'request',
      title: '要望です',
      userId: 'user_1',
      now: 1000,
    })
    const created = must(await S.readThread(d.db, 't1'), 'スレ')
    expect(created.title).toBe('要望です')
    expect(created.status).toBe('')
    expect(created.bumped_at).toBe(1000)

    await S.patchThread(
      d.db,
      't1',
      {
        status: 'planned',
        statusNote: '次で入れます',
        shippedVersion: '1.2.0',
        pinned: true,
        locked: true,
      },
      2000,
    )
    const patched = must(await S.readThread(d.db, 't1'), 'スレ')
    expect(patched.status).toBe('planned')
    expect(patched.status_note).toBe('次で入れます')
    expect(patched.shipped_version).toBe('1.2.0')
    expect(patched.pinned).toBe(1)
    expect(patched.locked).toBe(1)

    // 1 欄だけ変えても他の欄が落ちない（COALESCE が実 SQL で効いている）
    await S.patchThread(d.db, 't1', { pinned: false }, 3000)
    const repatched = must(await S.readThread(d.db, 't1'), 'スレ')
    expect(repatched.pinned).toBe(0)
    expect(repatched.locked).toBe(1)
    expect(repatched.status).toBe('planned')
    expect(repatched.shipped_version).toBe('1.2.0')

    // 返信は数え直し。伏せた投稿と本人が消した投稿は数えない
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1' })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2' })
    d.seed.post({ id: 'p3', thread_id: 't1', seq: 3, user_id: 'user_2', hidden_at: 500 })
    d.seed.post({ id: 'p4', thread_id: 't1', seq: 4, user_id: 'user_2', deleted_at: 500 })
    await S.bumpThread(d.db, 't1', 4000)
    const bumped = must(await S.readThread(d.db, 't1'), 'スレ')
    expect(bumped.bumped_at).toBe(4000)
    expect(bumped.reply_count).toBe(1)

    await S.hideThread(d.db, 't1', 5000)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').hidden_at).toBe(5000)
  })

  it('softDeleteThread: head-only は本文だけ、whole はスレ主の行だけ', async () => {
    d.seed.thread({ id: 't1', user_id: 'user_1' })
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1' })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2', hidden_at: 500 })

    await S.softDeleteThread(d.db, 't1', 'head-only', 7000, 'user_1')
    expect(must(await S.readPost(d.db, 'p1'), '本文').deleted_at).toBe(7000)
    // 運営が伏せた他人の返信に deleted_at を刻まない（unhide で戻せなくなる）
    expect(must(await S.readPost(d.db, 'p2'), '返信').deleted_at).toBe(0)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').deleted_at).toBe(0)

    d.seed.thread({ id: 't2', user_id: 'user_1' })
    d.seed.post({ id: 'q1', thread_id: 't2', seq: 1, user_id: 'user_1' })
    d.seed.post({ id: 'q2', thread_id: 't2', seq: 2, user_id: 'user_2' })

    await S.softDeleteThread(d.db, 't2', 'whole', 8000, 'user_1')
    expect(must(await S.readThread(d.db, 't2'), 'スレ').deleted_at).toBe(8000)
    expect(must(await S.readPost(d.db, 'q1'), '本文').deleted_at).toBe(8000)
    expect(must(await S.readPost(d.db, 'q2'), '返信').deleted_at).toBe(0)
  })

  it('softDeleteThread: スレ主の userId が無いときは投げる', async () => {
    await expect(S.softDeleteThread(d.db, 't1', 'whole', 1000, '')).rejects.toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// 投稿
// ---------------------------------------------------------------------------

describe('投稿', () => {
  beforeEach(() => {
    d.seed.profile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' })
    d.seed.thread({ id: 't1', user_id: 'user_1', kind: 'request', title: 'スレの題' })
  })

  it('createPost の採番は 1 文で行われ、reply_count も同じ batch で数え直される', async () => {
    expect(
      await S.createPost(d.db, {
        id: 'p1',
        threadId: 't1',
        userId: 'user_1',
        body: '本文',
        now: 1000,
      }),
    ).toEqual({ seq: 1 })
    expect(
      await S.createPost(d.db, {
        id: 'p2',
        threadId: 't1',
        userId: 'user_2',
        body: '返信',
        replyTo: 1,
        now: 2000,
      }),
    ).toEqual({ seq: 2 })
    expect(
      await S.createPost(d.db, {
        id: 'p3',
        threadId: 't1',
        userId: 'user_2',
        body: '返信2',
        now: 3000,
      }),
    ).toEqual({ seq: 3 })

    const thread = must(await S.readThread(d.db, 't1'), 'スレ')
    expect(thread.reply_count).toBe(2)
    expect(thread.bumped_at).toBe(3000)
    expect(must(await S.readPost(d.db, 'p2'), '投稿').reply_to).toBe(1)

    // UNIQUE(thread_id, seq) が最後の砦（同じ番号の行は生まれない）
    expect(() => d.seed.post({ id: 'p9', thread_id: 't1', seq: 3 })).toThrow()
  })

  it('softDeletePost / setPostHidden は reply_count を数え直す', async () => {
    await S.createPost(d.db, {
      id: 'p1',
      threadId: 't1',
      userId: 'user_1',
      body: '本文',
      now: 1000,
    })
    await S.createPost(d.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '返信',
      now: 2000,
    })
    await S.createPost(d.db, {
      id: 'p3',
      threadId: 't1',
      userId: 'user_2',
      body: '返信2',
      now: 3000,
    })
    expect(must(await S.readThread(d.db, 't1'), 'スレ').reply_count).toBe(2)

    await S.softDeletePost(d.db, 'p2', 4000)
    expect(must(await S.readPost(d.db, 'p2'), '投稿').deleted_at).toBe(4000)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').reply_count).toBe(1)

    await S.setPostHidden(d.db, 'p3', 5000)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').reply_count).toBe(0)
    // 解除（hiddenAt = 0）で件数が戻る
    await S.setPostHidden(d.db, 'p3', 0)
    expect(must(await S.readPost(d.db, 'p3'), '投稿').hidden_at).toBe(0)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').reply_count).toBe(1)

    // 無い投稿は何もしない（SQL を投げない）
    await S.softDeletePost(d.db, 'no-such', 6000)
    await S.setPostHidden(d.db, 'no-such', 6000)
    expect(await S.readPost(d.db, 'no-such')).toBeNull()
  })

  it('listPostsByUser はスレの見出しを一緒に返す', async () => {
    await S.createPost(d.db, {
      id: 'p1',
      threadId: 't1',
      userId: 'user_1',
      body: '本文',
      now: 1000,
    })
    await S.createPost(d.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_1',
      body: '続き',
      now: 2000,
    })
    await S.createPost(d.db, {
      id: 'p3',
      threadId: 't1',
      userId: 'user_2',
      body: '他人',
      now: 3000,
    })

    const rows = await S.listPostsByUser(d.db, 'user_1', 10)
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1'])
    expect(rows.map((r) => r.thread_title)).toEqual(['スレの題', 'スレの題'])
    expect(rows.map((r) => r.thread_kind)).toEqual(['request', 'request'])
  })
})

// ---------------------------------------------------------------------------
// 👍 / アンケート
// ---------------------------------------------------------------------------

describe('👍 とアンケート', () => {
  beforeEach(() => {
    d.seed.thread({ id: 't1', user_id: 'user_1', kind: 'request' })
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1' })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2' })
  })

  it('toggleLike は付ける・外すの往復で like_count を数え直す', async () => {
    const head = must(await S.readHeadPost(d.db, 't1'), 'スレ本文')
    expect(head.id).toBe('p1')

    expect(await S.toggleLike(d.db, head, 'user_1', 1000)).toEqual({ liked: true, likeCount: 1 })
    expect(await S.toggleLike(d.db, head, 'user_2', 2000)).toEqual({ liked: true, likeCount: 2 })
    expect(await S.toggleLike(d.db, head, 'user_1', 3000)).toEqual({ liked: false, likeCount: 1 })
    expect(await S.toggleLike(d.db, head, 'user_1', 4000)).toEqual({ liked: true, likeCount: 2 })
    expect(must(await S.readPost(d.db, 'p1'), '本文').like_count).toBe(2)
    // 本文への 👍 はスレ行にも写る（一覧の賛同数）。
    expect(must(await S.readThread(d.db, 't1'), 'スレ').like_count).toBe(2)
  })

  it('返信への 👍 は投稿だけを数え、スレ行の賛同数は動かさない', async () => {
    const reply = must(await S.readPost(d.db, 'p2'), '返信')
    expect(await S.toggleLike(d.db, reply, 'user_1', 1000)).toEqual({ liked: true, likeCount: 1 })
    expect(must(await S.readPost(d.db, 'p2'), '返信').like_count).toBe(1)
    expect(must(await S.readThread(d.db, 't1'), 'スレ').like_count).toBe(0)
  })

  it('createPoll / readPoll / insertVote / readVote / listVotes', async () => {
    expect(await S.readPoll(d.db, 't1')).toBeNull()

    await S.createPoll(d.db, {
      threadId: 't1',
      question: 'どれ？',
      options: ['A', 'B', 'C'],
      multiple: true,
      closesAt: 9000,
      now: 1000,
    })
    const poll = must(await S.readPoll(d.db, 't1'), 'アンケート')
    expect(poll.multiple).toBe(1)
    expect(S.toPoll(poll).options).toEqual(['A', 'B', 'C'])

    expect(
      await S.insertVote(d.db, { threadId: 't1', userId: 'user_1', choices: [0, 2], now: 2000 }),
    ).toEqual({ ok: true })
    // 1 アカウント 1 票。2 回目は書かない（上書きしない）
    expect(
      await S.insertVote(d.db, { threadId: 't1', userId: 'user_1', choices: [1], now: 3000 }),
    ).toEqual({ ok: false })
    expect(
      await S.insertVote(d.db, { threadId: 't1', userId: 'user_2', choices: [1], now: 4000 }),
    ).toEqual({ ok: true })

    const mine = must(await S.readVote(d.db, 't1', 'user_1'), '自分の票')
    expect(S.toVote(mine).choices).toEqual([0, 2])
    expect(await S.listVotes(d.db, 't1')).toHaveLength(2)
    expect(await S.readVote(d.db, 't1', 'user_9')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

describe('通報', () => {
  it('insertReport / listOpenReports / markReportHandled', async () => {
    await S.insertReport(d.db, {
      id: 'r2',
      postId: 'p1',
      userId: 'user_2',
      reason: '後',
      now: 2000,
    })
    await S.insertReport(d.db, {
      id: 'r1',
      postId: 'p1',
      userId: 'user_1',
      reason: '先',
      now: 1000,
    })

    const open = await S.listOpenReports(d.db, 10)
    expect(open.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(open[0]?.handled_at).toBe(0)

    expect(await S.markReportHandled(d.db, 'r1', 5000)).toBe(true)
    // 2 回目は時刻を上書きしない
    expect(await S.markReportHandled(d.db, 'r1', 6000)).toBe(false)
    expect(await S.markReportHandled(d.db, 'no-such', 6000)).toBe(false)

    expect((await S.listOpenReports(d.db, 10)).map((r) => r.id)).toEqual(['r2'])
    expect(
      d.row<{ handled_at: number }>('SELECT handled_at FROM board_reports WHERE id = ?', 'r1'),
    ).toEqual({ handled_at: 5000 })
  })
})

// ---------------------------------------------------------------------------
// リンクカード
// ---------------------------------------------------------------------------

describe('リンクカード', () => {
  const link = (over: Partial<LinkRow> = {}): LinkRow => ({
    url_key: 'k1',
    url: 'https://example.com/1',
    host: 'example.com',
    kind: 'ogp',
    title: 'タイトル',
    description: '説明',
    image_url: 'https://i/1',
    image_ok: 1,
    site_name: 'example',
    fetched_at: 1000,
    expires_at: 2000,
    blocked_at: 0,
    ...over,
  })

  it('upsertLink は新規と ON CONFLICT の更新の両方が通り、blocked_at を復活させない', async () => {
    await S.upsertLink(d.db, link())
    expect((await S.readLinks(d.db, ['k1']))[0]?.title).toBe('タイトル')

    // 運営が潰した後に再取得しても blocked_at は残る（カードが勝手に復活しない）
    await S.blockLink(d.db, 'k1', 5000)
    await S.upsertLink(d.db, link({ title: '新しい題', fetched_at: 6000, expires_at: 7000 }))
    const updated = must((await S.readLinks(d.db, ['k1']))[0], 'リンク')
    expect(updated.title).toBe('新しい題')
    expect(updated.fetched_at).toBe(6000)
    expect(updated.blocked_at).toBe(5000)
    // 潰した URL はカードにしない
    expect(S.toLinkCards([updated])).toEqual([])
  })

  it('readLinks の IN (...) は件数ぶんの ? を組み立てる', async () => {
    expect(await S.readLinks(d.db, [])).toEqual([])
    await S.upsertLink(d.db, link({ url_key: 'k1' }))
    await S.upsertLink(d.db, link({ url_key: 'k2', url: 'https://example.com/2' }))
    await S.upsertLink(d.db, link({ url_key: 'k3', url: 'https://example.com/3' }))

    expect((await S.readLinks(d.db, ['k1'])).map((r) => r.url_key)).toEqual(['k1'])
    const many = await S.readLinks(d.db, ['k1', 'k2', 'k3', 'no-such'])
    expect(many.map((r) => r.url_key).sort()).toEqual(['k1', 'k2', 'k3'])
  })

  it('linkPost / readPostLinks は結合しても列が曖昧にならない', async () => {
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1 })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2 })
    await S.upsertLink(d.db, link({ url_key: 'k1' }))
    await S.upsertLink(d.db, link({ url_key: 'k2', url: 'https://example.com/2', image_ok: 0 }))

    await S.linkPost(d.db, 'p1', [])
    await S.linkPost(d.db, 'p1', ['k1', 'k2'])
    // 二重送信でも ON CONFLICT DO NOTHING で増えない
    await S.linkPost(d.db, 'p1', ['k1', 'k2'])
    await S.linkPost(d.db, 'p2', ['k2'])

    expect(await S.readPostLinks(d.db, [])).toEqual(new Map())

    const map = await S.readPostLinks(d.db, ['p1', 'p2'])
    const p1 = must(map.get('p1'), 'p1 のリンク')
    // 本文での出現順（ord）で並ぶ
    expect(p1.map((r) => r.url_key)).toEqual(['k1', 'k2'])
    expect(p1.map((r) => r.url)).toEqual(['https://example.com/1', 'https://example.com/2'])
    expect(must(map.get('p2'), 'p2 のリンク').map((r) => r.url_key)).toEqual(['k2'])
    // image_ok=0 のカードは画像を落とす
    expect(S.toLinkCards(p1).map((c) => c.imageUrl)).toEqual(['https://i/1', ''])
  })
})

// ---------------------------------------------------------------------------
// レート制限の補助
// ---------------------------------------------------------------------------

describe('件数の集計', () => {
  it('countThreadsSince / countPostsSince', async () => {
    d.seed.thread({ id: 't1', user_id: 'user_1', created_at: 1000 })
    d.seed.thread({ id: 't2', user_id: 'user_1', created_at: 2000, deleted_at: 3000 })
    d.seed.thread({ id: 't3', user_id: 'user_2', created_at: 2000 })
    d.seed.post({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', created_at: 1000 })
    d.seed.post({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_1', created_at: 2000 })

    // 消して立て直す抜け道を作らないので、削除済みも数える
    expect(await S.countThreadsSince(d.db, 'user_1', 0)).toBe(2)
    expect(await S.countThreadsSince(d.db, 'user_1', 2000)).toBe(1)
    expect(await S.countThreadsSince(d.db, 'user_9', 0)).toBe(0)
    expect(await S.countPostsSince(d.db, 'user_1', 0)).toBe(2)
    expect(await S.countPostsSince(d.db, 'user_1', 2000)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 実行漏れの見張り（このファイルの最後に置く）
// ---------------------------------------------------------------------------

describe('board-store の export', () => {
  it('関数の export は 1 つ残らず実 SQLite に当てている', () => {
    const exported = Object.entries(boardStore)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
    // 列挙そのものが空（＝この見張りが何も見ていない）状態を先に潰す。
    expect(exported.length).toBeGreaterThanOrEqual(41)
    // 増えた export をこのファイルで叩いていなければ、ここが名前を挙げて落ちる。
    expect(exported.filter((name) => !called.has(name))).toEqual([])
  })
})
