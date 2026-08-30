// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * board-store（掲示板の D1 アクセス層）を、in-memory の D1 フェイクに当てて確かめる。
 *
 * 押さえるのは設計 §7 のうちこの層が担うもの:
 *   §7-5 返信のあるスレを削除すると、本文だけ消えて返信は残る
 *   §7-6 削除・非表示の投稿は本文を返さない（伏字）
 *   §7-7 1 アカウント 1 票（2 回目は書かない）
 * ＋ 集計列（seq の採番・reply_count・like_count）が数え直しでずれないこと。
 */
import { describe, expect, it } from 'vitest'
import {
  fakeLink,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from '../board/board-test-util'
import {
  blockLink,
  bumpThread,
  countPostsSince,
  countThreadsSince,
  createPoll,
  createPost,
  createThread,
  hideThread,
  insertReport,
  insertVote,
  linkPost,
  listOpenReports,
  listPostsByUser,
  listThreads,
  listVotes,
  markProfileDeleted,
  markReportHandled,
  patchThread,
  readLinks,
  readPoll,
  readPost,
  readPostLinks,
  readProfile,
  readThread,
  readThreadDetail,
  readVote,
  setBan,
  setPostHidden,
  softDeletePost,
  softDeleteThread,
  toAuthor,
  toggleLike,
  toLinkCards,
  toPoll,
  toPost,
  toProfile,
  toThread,
  upsertLink,
  upsertProfile,
} from './board-store'
import { checkRateLimit } from './rate-limit'

/** スレ 1 本と本文（seq=1）を置いた状態を作る。 */
async function seeded() {
  const store = makeBoardDb({ profiles: [fakeProfile()] })
  await createThread(store.db, {
    id: 't1',
    kind: 'request',
    title: '要望です',
    userId: 'user_1',
    now: 1000,
  })
  await createPost(store.db, {
    id: 'p1',
    threadId: 't1',
    userId: 'user_1',
    body: 'スレ本文',
    now: 1000,
  })
  return store
}

/** シードしたスレの本文（seq=1）。👍 は投稿の行に対して押す（0009）。 */
function headPost(store: ReturnType<typeof makeBoardDb>) {
  const head = store.posts.get('p1')
  if (!head) throw new Error('seed: p1 が無い')
  return head
}

describe('プロフィール', () => {
  it('登録して読み戻せる。role は member 既定', async () => {
    const store = makeBoardDb()
    expect(
      await upsertProfile(store.db, {
        userId: 'user_1',
        displayName: 'あさひ',
        nameKey: 'あさひ',
        now: 100,
      }),
    ).toEqual({ ok: true })

    const row = await readProfile(store.db, 'user_1')
    expect(row?.display_name).toBe('あさひ')
    expect(toProfile(row as NonNullable<typeof row>)).toMatchObject({
      userId: 'user_1',
      role: 'member',
      bannedUntil: 0,
      deletedAt: 0,
    })
  })

  it('正規化名が他人と重なれば duplicate（本人の改名は通る）', async () => {
    const store = makeBoardDb({
      profiles: [fakeProfile({ user_id: 'user_1', name_key: 'あさひ' })],
    })
    expect(
      await upsertProfile(store.db, {
        userId: 'user_2',
        displayName: 'あさひ',
        nameKey: 'あさひ',
        now: 100,
      }),
    ).toEqual({ ok: false, reason: 'duplicate' })
    expect(store.profiles.has('user_2')).toBe(false)

    expect(
      await upsertProfile(store.db, {
        userId: 'user_1',
        displayName: 'あさひ',
        nameKey: 'あさひ',
        now: 200,
      }),
    ).toEqual({ ok: true })
  })

  it('改名しても role と banned_until は落とさない（1 欄の更新で他を消さない）', async () => {
    const store = makeBoardDb({
      profiles: [fakeProfile({ role: 'staff', banned_until: 999, name_key: 'ふるいな' })],
    })
    await upsertProfile(store.db, {
      userId: 'user_1',
      displayName: '新しい名',
      nameKey: 'あたらしいな',
      now: 500,
    })
    const row = await readProfile(store.db, 'user_1')
    expect(row).toMatchObject({
      display_name: '新しい名',
      name_key: 'あたらしいな',
      role: 'staff',
      banned_until: 999,
      updated_at: 500,
    })
  })

  it('setBan / markProfileDeleted', async () => {
    const store = makeBoardDb({ profiles: [fakeProfile()] })
    await setBan(store.db, 'user_1', 8000, 100)
    expect((await readProfile(store.db, 'user_1'))?.banned_until).toBe(8000)

    await markProfileDeleted(store.db, 'user_1', 300)
    expect((await readProfile(store.db, 'user_1'))?.deleted_at).toBe(300)
    // 退会したら名前は伏せる（投稿そのものは残す）。
    expect(toAuthor({ author_name: 'あさひ', author_role: 'member', author_deleted: 300 })).toEqual(
      {
        displayName: '退会したユーザー',
        staff: false,
        retired: true,
      },
    )
  })
})

describe('createPost', () => {
  it('seq が 1,2,3 と増え、bumped_at と reply_count が更新される', async () => {
    const store = await seeded()
    expect((await readPost(store.db, 'p1'))?.seq).toBe(1)
    // スレ本文（seq=1）は返信に数えない。
    expect(store.threads.get('t1')?.reply_count).toBe(0)

    const r2 = await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '返信1',
      now: 2000,
    })
    const r3 = await createPost(store.db, {
      id: 'p3',
      threadId: 't1',
      userId: 'user_2',
      body: '返信2',
      replyTo: 2,
      now: 3000,
    })
    expect([r2.seq, r3.seq]).toEqual([2, 3])

    const t = store.threads.get('t1')
    expect(t?.bumped_at).toBe(3000)
    expect(t?.reply_count).toBe(2)
    expect(store.posts.get('p3')?.reply_to).toBe(2)
  })

  it('別スレの seq は独立して 1 から', async () => {
    const store = await seeded()
    await createThread(store.db, {
      id: 't2',
      kind: 'chat',
      title: '雑談',
      userId: 'user_1',
      now: 1500,
    })
    const r = await createPost(store.db, {
      id: 'q1',
      threadId: 't2',
      userId: 'user_1',
      body: 'こんにちは',
      now: 1500,
    })
    expect(r.seq).toBe(1)
  })

  it('bumpThread は返信数を数え直す（削除ぶんは減る）', async () => {
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '返信',
      now: 2000,
    })
    await softDeletePost(store.db, 'p2', 2500)
    expect(store.threads.get('t1')?.reply_count).toBe(0)

    await bumpThread(store.db, 't1', 4000)
    expect(store.threads.get('t1')).toMatchObject({ bumped_at: 4000, reply_count: 0 })
  })
})

describe('削除と非表示', () => {
  it('head-only は seq=1 だけ落ち、返信は残る（§7-5）', async () => {
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '他人の返信',
      now: 2000,
    })

    await softDeleteThread(store.db, 't1', 'head-only', 5000, 'user_1')

    expect(store.posts.get('p1')?.deleted_at).toBe(5000)
    expect(store.posts.get('p2')?.deleted_at).toBe(0)
    // スレ行そのものは生きたまま（一覧から消さない）。
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
  })

  it('whole はスレ行とスレ主の投稿に deleted_at を入れる（行は消さない）', async () => {
    const store = await seeded()
    await softDeleteThread(store.db, 't1', 'whole', 5000, 'user_1')
    expect(store.threads.get('t1')?.deleted_at).toBe(5000)
    expect(store.posts.get('p1')?.deleted_at).toBe(5000)
    expect(store.posts.size).toBe(1)
  })

  it('whole でも他人の投稿には deleted_at を刻まない（運営の非表示を塗り替えない）', async () => {
    // 再現手順: staff が他人の返信を hide → スレ主がスレを削除。
    // かつては reply_count が 0 に戻るせいで mode='whole' が選ばれ、
    // `WHERE thread_id = ?` が他人の hidden 投稿にも deleted_at を刻んでいた。
    // ここでは mode の判断（permission.ts）に頼らず、store が 'whole' を渡されても
    // 他人の行に触れないことを直に固定する。
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '他人の返信',
      now: 2000,
    })
    await setPostHidden(store.db, 'p2', 3000)

    await softDeleteThread(store.db, 't1', 'whole', 5000, 'user_1')

    // 他人の投稿は「運営が非表示」のまま。本人が消したことにしない。
    expect(store.posts.get('p2')).toMatchObject({ hidden_at: 3000, deleted_at: 0 })
    // staff が unhide すれば元通り読める＝運営の措置が可逆に保たれている。
    await setPostHidden(store.db, 'p2', 0)
    const detail = await readThreadDetail(store.db, 't1', 'user_2')
    const p2 = (detail?.posts ?? []).find((p) => p.id === 'p2')
    expect(toPost(p2 as NonNullable<typeof p2>).body).toBe('他人の返信')
    // スレ主ぶん（スレ行と seq=1）はちゃんと落ちている。
    expect(store.threads.get('t1')?.deleted_at).toBe(5000)
    expect(store.posts.get('p1')?.deleted_at).toBe(5000)
  })

  it('head-only も本人の seq=1 だけ落とす。userId 無しの呼び出しは TypeError', async () => {
    const store = await seeded()
    // スレ主でない userId を渡しても、他人のスレの本文は落とせない。
    await softDeleteThread(store.db, 't1', 'head-only', 5000, 'user_2')
    expect(store.posts.get('p1')?.deleted_at).toBe(0)

    // 旧シグネチャ（4 引数）のままの呼び出しは黙って全消しに倒れず、その場で止まる。
    // functions/ は tsconfig の include に無く、pnpm typecheck が引数の欠落を見つけないため。
    await expect(
      softDeleteThread(store.db, 't1', 'whole', 5000, undefined as unknown as string),
    ).rejects.toThrow(TypeError)
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
  })

  it('削除・非表示の投稿は本文を返さず伏字になる（§7-6）', async () => {
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '消される本文',
      now: 2000,
    })
    await softDeletePost(store.db, 'p2', 2500)
    await createPost(store.db, {
      id: 'p3',
      threadId: 't1',
      userId: 'user_2',
      body: '隠される本文',
      now: 3000,
    })
    await setPostHidden(store.db, 'p3', 3500)

    const detail = await readThreadDetail(store.db, 't1', 'user_1')
    const bodies = (detail?.posts ?? []).map((p) => toPost(p, { viewerId: 'user_1' }).body)
    expect(bodies).toEqual([
      'スレ本文',
      'この投稿は削除されました',
      'この投稿は運営が非表示にしました',
    ])
    // 伏せた投稿は返信数にも数えない。
    expect(store.threads.get('t1')?.reply_count).toBe(0)
  })

  it('hideThread はスレを一覧から外す', async () => {
    const store = await seeded()
    await hideThread(store.db, 't1', 6000)
    expect((await readThread(store.db, 't1'))?.hidden_at).toBe(6000)
    expect((await listThreads(store.db, {})).rows).toHaveLength(0)
  })
})

describe('listThreads', () => {
  it('削除・非表示は返さず、pinned が先頭に来る', async () => {
    const store = makeBoardDb({
      profiles: [fakeProfile()],
      threads: [
        fakeThread({ id: 'a', bumped_at: 3000 }),
        fakeThread({ id: 'b', bumped_at: 4000 }),
        fakeThread({ id: 'pin', bumped_at: 1000, pinned: 1 }),
        fakeThread({ id: 'del', bumped_at: 9000, deleted_at: 1 }),
        fakeThread({ id: 'hid', bumped_at: 9000, hidden_at: 1 }),
      ],
      posts: [fakePost({ id: 'ha', thread_id: 'a', body: '本文A' })],
    })

    const { rows, nextCursor } = await listThreads(store.db, { viewerId: 'user_1' })
    expect(rows.map((r) => r.id)).toEqual(['pin', 'b', 'a'])
    expect(nextCursor).toBeNull()

    // 抜粋は seq=1 の本文から。表示名は毎回プロフィールから引く。
    const view = toThread(rows[2], 'user_1')
    expect(view.excerpt).toBe('本文A')
    expect(view.author.displayName).toBe('名無しの作者')
    expect(view.mine).toBe(true)
  })

  it('kind で絞れる', async () => {
    const store = makeBoardDb({
      threads: [
        fakeThread({ id: 'a', kind: 'bug' }),
        fakeThread({ id: 'b', kind: 'chat', bumped_at: 2000 }),
      ],
    })
    const { rows } = await listThreads(store.db, { kind: 'chat' })
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('cursor で続きを取り、同時刻でも取りこぼさない', async () => {
    const store = makeBoardDb({
      threads: [
        fakeThread({ id: 'a', bumped_at: 5000 }),
        fakeThread({ id: 'b', bumped_at: 5000 }),
        fakeThread({ id: 'c', bumped_at: 5000 }),
      ],
    })
    const page1 = await listThreads(store.db, { limit: 2 })
    expect(page1.rows.map((r) => r.id)).toEqual(['c', 'b'])
    expect(page1.nextCursor).toBe('0:5000:b')

    const page2 = await listThreads(store.db, { limit: 2, cursor: page1.nextCursor })
    expect(page2.rows.map((r) => r.id)).toEqual(['a'])
    expect(page2.nextCursor).toBeNull()
  })

  it('👍 の有無は閲覧者ごとに変わる（一覧に出るのはスレ本文への 👍）', async () => {
    const store = await seeded()
    await toggleLike(store.db, headPost(store), 'user_2', 100)
    expect((await listThreads(store.db, { viewerId: 'user_2' })).rows[0]?.liked).toBe(1)
    expect((await listThreads(store.db, { viewerId: 'user_1' })).rows[0]?.liked).toBe(0)
    expect((await listThreads(store.db, {})).rows[0]?.liked).toBe(0)
  })
})

describe('readThreadDetail', () => {
  it('スレ・投稿・poll・自分の票・票一覧・リンクを 1 回で返す', async () => {
    const store = await seeded()
    store.profiles.set('user_2', fakeProfile({ user_id: 'user_2', display_name: 'ふたり' }))
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: 'リンク付き',
      now: 2000,
    })
    await createPoll(store.db, {
      threadId: 't1',
      question: 'どれ？',
      options: ['A', 'B'],
      multiple: false,
      closesAt: 9000,
      now: 1000,
    })
    await insertVote(store.db, { threadId: 't1', userId: 'user_1', choices: [0], now: 1200 })
    await insertVote(store.db, { threadId: 't1', userId: 'user_2', choices: [1], now: 1300 })
    await upsertLink(
      store.db,
      fakeLink({ url_key: 'k1', image_ok: 1, image_url: 'https://i/x.png' }),
    )
    await linkPost(store.db, 'p2', ['k1'])

    const d = await readThreadDetail(store.db, 't1', 'user_1')
    expect(d).not.toBeNull()
    if (!d) return
    expect(d.thread.id).toBe('t1')
    expect(d.posts.map((p) => p.seq)).toEqual([1, 2])
    expect(toPoll(d.poll as NonNullable<typeof d.poll>).options).toEqual(['A', 'B'])
    expect(d.myVote?.user_id).toBe('user_1')
    expect(d.votes).toHaveLength(2)

    const p2 = toPost(d.posts[1], { viewerId: 'user_1', links: d.links.get('p2') })
    expect(p2.author.displayName).toBe('ふたり')
    expect(p2.mine).toBe(false)
    expect(p2.links).toEqual([
      {
        url: 'https://example.com/a',
        host: 'example.com',
        kind: 'ogp',
        title: 'タイトル',
        description: '説明',
        imageUrl: 'https://i/x.png',
        siteName: 'example',
      },
    ])
  })

  it('無いスレは null', async () => {
    const store = makeBoardDb()
    expect(await readThreadDetail(store.db, 'nope', null)).toBeNull()
  })
})

describe('patchThread', () => {
  it('渡した項目だけ書き換え、他は据え置く', async () => {
    const store = await seeded()
    await patchThread(store.db, 't1', { status: 'planned', statusNote: '次の版で' }, 100)
    await patchThread(store.db, 't1', { pinned: true }, 200)

    expect(store.threads.get('t1')).toMatchObject({
      status: 'planned',
      status_note: '次の版で',
      pinned: 1,
      locked: 0,
      shipped_version: '',
    })

    await patchThread(store.db, 't1', { locked: true, shippedVersion: 'v1.2.0' }, 300)
    expect(store.threads.get('t1')).toMatchObject({
      status: 'planned',
      status_note: '次の版で',
      pinned: 1,
      locked: 1,
      shipped_version: 'v1.2.0',
    })
  })
})

describe('toggleLike', () => {
  it('2 回で元に戻り、like_count が board_post_likes と一致する', async () => {
    const store = await seeded()
    const head = headPost(store)

    const on = await toggleLike(store.db, head, 'user_2', 100)
    expect(on).toEqual({ liked: true, likeCount: 1 })
    expect(store.posts.get('p1')?.like_count).toBe(1)
    // 本文（seq=1）への 👍 はスレ行にも写る＝一覧の賛同数がそのまま使える。
    expect(store.threads.get('t1')?.like_count).toBe(1)

    const off = await toggleLike(store.db, head, 'user_2', 200)
    expect(off).toEqual({ liked: false, likeCount: 0 })
    expect(store.threads.get('t1')?.like_count).toBe(0)
    expect(store.postLikes.size).toBe(0)

    // 別の人が押しても数え直しで一致する。
    await toggleLike(store.db, head, 'user_2', 300)
    await toggleLike(store.db, head, 'user_3', 400)
    expect(store.threads.get('t1')?.like_count).toBe(2)
  })

  it('返信への 👍 は投稿だけを数え、スレ行の賛同数は動かさない', async () => {
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '返信',
      now: 2000,
    })
    const reply = store.posts.get('p2')
    if (!reply) throw new Error('seed: p2 が無い')

    expect(await toggleLike(store.db, reply, 'user_3', 100)).toEqual({ liked: true, likeCount: 1 })
    expect(store.posts.get('p2')?.like_count).toBe(1)
    expect(store.threads.get('t1')?.like_count).toBe(0)
  })

  it('投稿の行ではなくスレ id を渡したら止まる（typecheck の外なので実行時に落とす）', async () => {
    const store = await seeded()
    await expect(
      // @ts-expect-error 0009 以前の呼び方。取り違えたまま動かすと数が増えない 👍 になる
      toggleLike(store.db, 't1', 'user_2', 100),
    ).rejects.toThrow(TypeError)
  })
})

describe('アンケート', () => {
  it('1 アカウント 1 票。2 回目は false で上書きしない（§7-7）', async () => {
    const store = await seeded()
    await createPoll(store.db, {
      threadId: 't1',
      question: '次はどれ？',
      options: ['A', 'B', 'C'],
      multiple: true,
      closesAt: 9000,
      now: 1000,
    })

    expect(
      await insertVote(store.db, { threadId: 't1', userId: 'u', choices: [0], now: 1100 }),
    ).toEqual({ ok: true })
    expect(
      await insertVote(store.db, { threadId: 't1', userId: 'u', choices: [1, 2], now: 1200 }),
    ).toEqual({ ok: false })

    const v = await readVote(store.db, 't1', 'u')
    expect(v?.choices).toBe('[0]')
    expect(await listVotes(store.db, 't1')).toHaveLength(1)

    const poll = await readPoll(store.db, 't1')
    expect(toPoll(poll as NonNullable<typeof poll>)).toMatchObject({
      question: '次はどれ？',
      options: ['A', 'B', 'C'],
      multiple: true,
      closesAt: 9000,
    })
  })
})

describe('通報', () => {
  it('キューに積むだけ（自動非表示はしない）', async () => {
    const store = await seeded()
    await insertReport(store.db, {
      id: 'r1',
      postId: 'p1',
      userId: 'user_2',
      reason: '宣伝です',
      now: 700,
    })
    expect(store.reports.get('r1')).toMatchObject({ post_id: 'p1', handled_at: 0 })
    expect(store.posts.get('p1')?.hidden_at).toBe(0)
  })

  it('listOpenReports は未処理だけを古い順に返し、markReportHandled で消える', async () => {
    const store = await seeded()
    const add = (id: string, now: number) =>
      insertReport(store.db, { id, postId: 'p1', userId: 'user_2', reason: `理由${id}`, now })
    // わざと古い順と逆に積む（挿入順ではなく created_at 順で返ることを見る）。
    await add('r3', 3000)
    await add('r1', 1000)
    await add('r2', 2000)

    expect((await listOpenReports(store.db, 10)).map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    // limit は先頭（＝いちばん古い）から数える。
    expect((await listOpenReports(store.db, 2)).map((r) => r.id)).toEqual(['r1', 'r2'])

    expect(await markReportHandled(store.db, 'r1', 9000)).toBe(true)
    expect(store.reports.get('r1')?.handled_at).toBe(9000)
    expect((await listOpenReports(store.db, 10)).map((r) => r.id)).toEqual(['r2', 'r3'])

    // 2 回目は false。「いつ運営が見たか」を後から書き換えない。
    expect(await markReportHandled(store.db, 'r1', 9999)).toBe(false)
    expect(store.reports.get('r1')?.handled_at).toBe(9000)
    // 無い id も false（呼び出し側はこれで 404 を判断できる）。
    expect(await markReportHandled(store.db, 'nope', 9999)).toBe(false)
  })
})

describe('リンクカード', () => {
  it('再取得しても blocked_at は復活しない。潰したカードは出さない', async () => {
    const store = makeBoardDb()
    await upsertLink(store.db, fakeLink({ url_key: 'k1', title: '前' }))
    await blockLink(store.db, 'k1', 5000)
    await upsertLink(store.db, fakeLink({ url_key: 'k1', title: '後', fetched_at: 6000 }))

    const rows = await readLinks(store.db, ['k1'])
    expect(rows[0]).toMatchObject({ title: '後', blocked_at: 5000 })
    expect(toLinkCards(rows)).toEqual([])
  })

  it('image_ok=0 のホストは画像を落とす。kind=none はカードにしない', async () => {
    const store = makeBoardDb()
    await upsertLink(
      store.db,
      fakeLink({ url_key: 'k1', image_url: 'https://evil/x.png', image_ok: 0 }),
    )
    await upsertLink(store.db, fakeLink({ url_key: 'k2', kind: 'none', url: 'https://x/404' }))

    const cards = toLinkCards(await readLinks(store.db, ['k1', 'k2']))
    expect(cards).toHaveLength(1)
    expect(cards[0].imageUrl).toBe('')
  })

  it('readPostLinks は投稿ごとに ord の順で返す（空なら DB を叩かない）', async () => {
    const store = await seeded()
    await upsertLink(store.db, fakeLink({ url_key: 'k1', url: 'https://a/1' }))
    await upsertLink(store.db, fakeLink({ url_key: 'k2', url: 'https://b/2' }))
    await linkPost(store.db, 'p1', ['k1', 'k2'])

    const map = await readPostLinks(store.db, ['p1'])
    expect(map.get('p1')?.map((l) => l.url)).toEqual(['https://a/1', 'https://b/2'])
    expect((await readPostLinks(store.db, [])).size).toBe(0)
    expect(await readLinks(store.db, [])).toEqual([])
  })
})

describe('レート制限の補助', () => {
  it('countThreadsSince / countPostsSince は本人ぶんだけ数える', async () => {
    const store = await seeded()
    await createThread(store.db, {
      id: 't2',
      kind: 'chat',
      title: '雑談',
      userId: 'user_1',
      now: 5000,
    })
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_2',
      body: '他人の返信',
      now: 6000,
    })

    expect(await countThreadsSince(store.db, 'user_1', 0)).toBe(2)
    expect(await countThreadsSince(store.db, 'user_1', 2000)).toBe(1)
    expect(await countThreadsSince(store.db, 'user_2', 0)).toBe(0)
    // 削除しても数える（消して立て直せば上限を無視できる、を作らない）。
    await softDeleteThread(store.db, 't2', 'whole', 7000, 'user_1')
    expect(await countThreadsSince(store.db, 'user_1', 0)).toBe(2)

    expect(await countPostsSince(store.db, 'user_1', 0)).toBe(1)
    expect(await countPostsSince(store.db, 'user_2', 0)).toBe(1)
  })

  it('フェイクの env で checkRateLimit が動く（board: 接頭辞のキー・§7-11）', async () => {
    const store = makeBoardDb()
    const env = makeBoardEnv({ store })
    const now = 1_700_000_000_000
    expect(await checkRateLimit(env.DB, 'board:user_1', now, 2)).toBe(true)
    expect(await checkRateLimit(env.DB, 'board:user_1', now, 2)).toBe(true)
    expect(await checkRateLimit(env.DB, 'board:user_1', now, 2)).toBe(false)
    // 同期の枠（素の userId）とは別行なので食い合わない。
    expect(await checkRateLimit(env.DB, 'user_1', now, 2)).toBe(true)
    expect(store.rates.size).toBe(2)
  })
})

describe('listPostsByUser', () => {
  it('新しい順で、スレの見出しも一緒に返す', async () => {
    const store = await seeded()
    await createPost(store.db, {
      id: 'p2',
      threadId: 't1',
      userId: 'user_1',
      body: 'あとの投稿',
      now: 8000,
    })
    const rows = await listPostsByUser(store.db, 'user_1', 10)
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1'])
    expect(rows[0].thread_title).toBe('要望です')
    expect(rows[0].thread_kind).toBe('request')
  })
})
