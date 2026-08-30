/// <reference types="@cloudflare/workers-types" />
/**
 * 掲示板 API テスト用の in-memory D1 フェイク（board_* 9 テーブル ＋ rate_limits）。
 * `functions/api/sync/sync-test-util.ts` の流儀＝**SQL 文字列の部分一致で分岐する**簡易実装。
 *
 * 相手にするのは `functions/api/_lib/board-store.ts` が出す SQL だけでよい
 *（掲示板の SQL はあの 1 ファイルに集約してある）。**未対応の SQL は throw する**＝
 * store に新しいクエリが増えたのにフェイクが追随していない、をテストが即座に知らせる。
 * 黙って空を返すと、通ったつもりのテストが何も検証しない状態になる。
 *
 * 使い方:
 *   const store = makeBoardDb()
 *   const env = makeBoardEnv({ store })
 *   store.threads.set('t1', fakeThread({ id: 't1' }))
 */

// ---------------------------------------------------------------------------
// 行の型（board-store.ts の *Row と同形。テスト側から import しやすいよう再定義しない）
// ---------------------------------------------------------------------------

import type {
  LikeRow,
  LinkRow,
  PollRow,
  PostLinkRow,
  PostRow,
  ProfileRow,
  ReportRow,
  ThreadRow,
  VoteRow,
} from '../_lib/board-store'

/** `board_likes` の 1 行（store の LikeRow と同じ。テストから import しやすいよう別名で出す）。 */
export type FakeLikeRow = LikeRow

export interface FakeRateRow {
  user_id: string
  window_start: number
  count: number
}

/** テストが直接いじれる 9 テーブル ＋ rate_limits。 */
export interface BoardTables {
  profiles: Map<string, ProfileRow>
  threads: Map<string, ThreadRow>
  posts: Map<string, PostRow>
  likes: Map<string, FakeLikeRow>
  polls: Map<string, PollRow>
  votes: Map<string, VoteRow>
  reports: Map<string, ReportRow>
  links: Map<string, LinkRow>
  postLinks: Map<string, PostLinkRow>
  rates: Map<string, FakeRateRow>
}

export interface BoardDbFake extends BoardTables {
  db: D1Database
}

/** `(thread_id, user_id)` などの複合主キーを Map のキーに畳む。 */
const pairKey = (a: string, b: string) => `${a}:${b}`

// ---------------------------------------------------------------------------
// シード用ファクトリ
// ---------------------------------------------------------------------------

export function fakeProfile(over: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: 'user_1',
    display_name: '名無しの作者',
    name_key: 'ななしのさくしゃ',
    role: 'member',
    banned_until: 0,
    deleted_at: 0,
    created_at: 1000,
    updated_at: 1000,
    ...over,
  }
}

export function fakeThread(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 't1',
    kind: 'request',
    title: 'タイトル',
    user_id: 'user_1',
    status: '',
    status_note: '',
    shipped_version: '',
    pinned: 0,
    locked: 0,
    reply_count: 0,
    like_count: 0,
    created_at: 1000,
    bumped_at: 1000,
    deleted_at: 0,
    hidden_at: 0,
    ...over,
  }
}

export function fakePost(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    thread_id: 't1',
    seq: 1,
    user_id: 'user_1',
    body: '本文',
    reply_to: 0,
    created_at: 1000,
    deleted_at: 0,
    hidden_at: 0,
    ...over,
  }
}

export function fakeLink(over: Partial<LinkRow> = {}): LinkRow {
  return {
    url_key: 'k1',
    url: 'https://example.com/a',
    host: 'example.com',
    kind: 'ogp',
    title: 'タイトル',
    description: '説明',
    image_url: '',
    image_ok: 0,
    site_name: 'example',
    fetched_at: 1000,
    expires_at: 1000 + 7 * 24 * 3600 * 1000,
    blocked_at: 0,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Clerk 認証のモック
// ---------------------------------------------------------------------------

/**
 * `vi.mock('@clerk/backend')` に流し込む中身。テスト側では `vi.hoisted` の状態と組で使う。
 *
 *   const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
 *   vi.mock('@clerk/backend', async () => {
 *     const { clerkAuthMock } = await import('./board-test-util')
 *     return clerkAuthMock(authState)
 *   })
 *
 * `authState.userId = null` で未認証（掲示板は読み取りだけ通り、書き込みは 401）。
 */
export function clerkAuthMock(state: { userId: string | null }) {
  return {
    createClerkClient: () => ({
      authenticateRequest: async () => {
        const userId = state.userId
        return userId
          ? { isAuthenticated: true, toAuth: () => ({ userId }) }
          : { isAuthenticated: false }
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// D1 フェイク
// ---------------------------------------------------------------------------

interface FakeStmt {
  __sql: string
  __args: unknown[]
  bind(...args: unknown[]): FakeStmt
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ success: true; results: T[]; meta: { changes: number } }>
  run(): Promise<{ success: true; results: unknown[]; meta: { changes: number } }>
}

/** 一覧・詳細で返す JOIN 済みの 1 行を組み立てる（board-store の ThreadListRow と同形）。 */
function listRowOf(t: ThreadRow, tables: BoardTables, viewerId: string | null) {
  const head = [...tables.posts.values()].find((p) => p.thread_id === t.id && p.seq === 1) ?? null
  const author = tables.profiles.get(t.user_id) ?? null
  return {
    ...t,
    head_body: head?.body ?? null,
    head_deleted_at: head?.deleted_at ?? null,
    head_hidden_at: head?.hidden_at ?? null,
    author_name: author?.display_name ?? null,
    author_role: author?.role ?? null,
    author_deleted: author?.deleted_at ?? null,
    has_poll: tables.polls.has(t.id) ? 1 : 0,
    liked: viewerId && tables.likes.has(pairKey(t.id, viewerId)) ? 1 : 0,
  }
}

/** 投稿 ＋ 現在の表示名（board-store の PostWithAuthorRow と同形）。 */
function postRowOf(p: PostRow, tables: BoardTables) {
  const author = tables.profiles.get(p.user_id) ?? null
  return {
    ...p,
    author_name: author?.display_name ?? null,
    author_role: author?.role ?? null,
    author_deleted: author?.deleted_at ?? null,
  }
}

/** 生きている返信（seq>=2・削除も非表示もされていない）の件数。 */
const replyCountOf = (tables: BoardTables, threadId: string): number =>
  [...tables.posts.values()].filter(
    (p) => p.thread_id === threadId && p.seq > 1 && p.deleted_at === 0 && p.hidden_at === 0,
  ).length

const likeCountOf = (tables: BoardTables, threadId: string): number =>
  [...tables.likes.values()].filter((l) => l.thread_id === threadId).length

/**
 * board_* 9 テーブル ＋ rate_limits を Map で持つ D1 フェイク。
 * `prepare().bind().first()/.all()/.run()` と `batch()` を実装する。
 * `batch()` は実 D1 と同じく **SELECT でも結果を返す**（board-store の readThreadDetail が
 * 1 回の batch で 6 本読むため）。
 */
export function makeBoardDb(
  opts: { profiles?: ProfileRow[]; threads?: ThreadRow[]; posts?: PostRow[] } = {},
): BoardDbFake {
  const tables: BoardTables = {
    profiles: new Map(),
    threads: new Map(),
    posts: new Map(),
    likes: new Map(),
    polls: new Map(),
    votes: new Map(),
    reports: new Map(),
    links: new Map(),
    postLinks: new Map(),
    rates: new Map(),
  }
  for (const p of opts.profiles ?? []) tables.profiles.set(p.user_id, p)
  for (const t of opts.threads ?? []) tables.threads.set(t.id, t)
  for (const p of opts.posts ?? []) tables.posts.set(p.id, p)

  // -------------------------------------------------------------------------
  // SELECT（1 行）
  // -------------------------------------------------------------------------
  function first(sql: string, args: unknown[]): unknown {
    if (sql.includes('FROM board_profiles WHERE user_id = ?')) {
      return tables.profiles.get(args[0] as string) ?? null
    }
    if (sql.includes('FROM board_profiles WHERE name_key = ?')) {
      const key = args[0] as string
      return [...tables.profiles.values()].find((p) => p.name_key === key) ?? null
    }
    if (sql.includes('COUNT(*) AS n FROM board_threads')) {
      const [userId, since] = args as [string, number]
      const n = [...tables.threads.values()].filter(
        (t) => t.user_id === userId && t.created_at >= since,
      ).length
      return { n }
    }
    if (sql.includes('COUNT(*) AS n FROM board_posts')) {
      const [userId, since] = args as [string, number]
      const n = [...tables.posts.values()].filter(
        (p) => p.user_id === userId && p.created_at >= since,
      ).length
      return { n }
    }
    if (sql.includes('SELECT like_count FROM board_threads')) {
      const t = tables.threads.get(args[0] as string)
      return t ? { like_count: t.like_count } : null
    }
    if (sql.includes('FROM board_threads WHERE id = ?')) {
      return tables.threads.get(args[0] as string) ?? null
    }
    if (sql.includes('SELECT seq FROM board_posts WHERE id = ?')) {
      const p = tables.posts.get(args[0] as string)
      return p ? { seq: p.seq } : null
    }
    if (sql.includes('FROM board_posts WHERE id = ?')) {
      return tables.posts.get(args[0] as string) ?? null
    }
    if (sql.includes('FROM board_likes WHERE thread_id = ? AND user_id = ?')) {
      const [threadId, userId] = args as [string, string]
      return tables.likes.get(pairKey(threadId, userId)) ?? null
    }
    if (sql.includes('FROM board_polls WHERE thread_id = ?')) {
      return tables.polls.get(args[0] as string) ?? null
    }
    if (sql.includes('FROM board_votes WHERE thread_id = ? AND user_id = ?')) {
      const [threadId, userId] = args as [string, string]
      return tables.votes.get(pairKey(threadId, userId)) ?? null
    }
    if (sql.includes('FROM rate_limits')) {
      return tables.rates.get(args[0] as string) ?? null
    }
    throw new Error(`makeBoardDb: first 未対応 SQL: ${sql}`)
  }

  // -------------------------------------------------------------------------
  // SELECT（複数行）
  // -------------------------------------------------------------------------
  function all(sql: string, args: unknown[]): unknown[] {
    if (sql.includes('FROM board_threads t')) {
      // 一覧（listThreads）と詳細のスレ行（readThreadDetail）。bind の順序は
      // [viewerId, (kind), (cursor×6), (threadId), (limit)] で、SQL の見た目と一致する。
      let i = 0
      const viewerId = (args[i++] as string | null) ?? null
      // 種別の絞り込みは `t.kind IN (?, ?, ...)`（要望タブが旧 suggestion も拾うため
      // 複数を渡す）。プレースホルダの数だけ bind を進めないと、以降の cursor/limit が
      // 1 つずつずれて「空の一覧」に化ける。
      const inClause = /AND t\.kind IN \(([?,\s]+)\)/.exec(sql)
      const kinds = inClause
        ? ((): string[] => {
            const n = (inClause[1] ?? '').split(',').length
            const picked = args.slice(i, i + n) as string[]
            i += n
            return picked
          })()
        : null
      let cursor: { pinned: number; bumpedAt: number; id: string } | null = null
      if (sql.includes('t.pinned < ?')) {
        const pinned = args[i] as number
        const bumpedAt = args[i + 2] as number
        const id = args[i + 5] as string
        i += 6
        cursor = { pinned, bumpedAt, id }
      }
      if (sql.includes('WHERE t.id = ?')) {
        const t = tables.threads.get(args[i] as string)
        return t ? [listRowOf(t, tables, viewerId)] : []
      }
      const limit = sql.includes('LIMIT ?') ? (args[i] as number) : Number.POSITIVE_INFINITY
      return [...tables.threads.values()]
        .filter((t) => t.deleted_at === 0 && t.hidden_at === 0)
        .filter((t) => !kinds || kinds.includes(t.kind))
        .filter((t) => {
          if (!cursor) return true
          if (t.pinned !== cursor.pinned) return t.pinned < cursor.pinned
          if (t.bumped_at !== cursor.bumpedAt) return t.bumped_at < cursor.bumpedAt
          return t.id < cursor.id
        })
        .sort(
          (a, b) =>
            b.pinned - a.pinned ||
            b.bumped_at - a.bumped_at ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .slice(0, limit)
        .map((t) => listRowOf(t, tables, viewerId))
    }
    if (sql.includes('FROM board_posts p') && sql.includes('LEFT JOIN board_profiles pr')) {
      // 詳細の投稿一覧（seq 昇順）。
      const threadId = args[0] as string
      return [...tables.posts.values()]
        .filter((p) => p.thread_id === threadId)
        .sort((a, b) => a.seq - b.seq)
        .map((p) => postRowOf(p, tables))
    }
    if (sql.includes('FROM board_posts p') && sql.includes('LEFT JOIN board_threads t')) {
      // 「自分の書き込み」タブ（新しい順・スレの見出し付き）。
      const [userId, limit] = args as [string, number]
      return [...tables.posts.values()]
        .filter((p) => p.user_id === userId)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit)
        .map((p) => {
          const t = tables.threads.get(p.thread_id) ?? null
          return { ...p, thread_title: t?.title ?? null, thread_kind: t?.kind ?? null }
        })
    }
    if (sql.includes('FROM board_post_links pl')) {
      // 投稿 → リンク行。スレ単位（詳細）と post_id 単位（readPostLinks）の 2 通り。
      const postIds = sql.includes('JOIN board_posts p')
        ? [...tables.posts.values()]
            .filter((p) => p.thread_id === (args[0] as string))
            .map((p) => p.id)
        : (args as string[])
      const set = new Set(postIds)
      return [...tables.postLinks.values()]
        .filter((pl) => set.has(pl.post_id))
        .sort((a, b) => (a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : a.ord - b.ord))
        .flatMap((pl) => {
          const link = tables.links.get(pl.url_key)
          return link ? [{ post_id: pl.post_id, ...link }] : []
        })
    }
    if (sql.includes('FROM board_links WHERE url_key IN')) {
      const keys = new Set(args as string[])
      return [...tables.links.values()].filter((l) => keys.has(l.url_key))
    }
    if (sql.includes('FROM board_votes WHERE thread_id = ? AND user_id = ?')) {
      const [threadId, userId] = args as [string, string]
      const v = tables.votes.get(pairKey(threadId, userId))
      return v ? [v] : []
    }
    if (sql.includes('FROM board_votes WHERE thread_id = ?')) {
      const threadId = args[0] as string
      return [...tables.votes.values()].filter((v) => v.thread_id === threadId)
    }
    if (sql.includes('FROM board_polls WHERE thread_id = ?')) {
      const p = tables.polls.get(args[0] as string)
      return p ? [p] : []
    }
    if (sql.includes('FROM board_reports WHERE handled_at = 0')) {
      // 運営のキュー（listOpenReports）。古い順・同時刻は id 順で、LIMIT まで。
      const limit = args[0] as number
      return [...tables.reports.values()]
        .filter((r) => r.handled_at === 0)
        .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit)
    }
    throw new Error(`makeBoardDb: all 未対応 SQL: ${sql}`)
  }

  // -------------------------------------------------------------------------
  // INSERT / UPDATE / DELETE
  // -------------------------------------------------------------------------
  function run(sql: string, args: unknown[]): number {
    // --- profiles ---------------------------------------------------------
    if (sql.startsWith('INSERT INTO board_profiles')) {
      const [user_id, display_name, name_key, created_at, updated_at] = args as [
        string,
        string,
        string,
        number,
        number,
      ]
      const clash = [...tables.profiles.values()].find(
        (p) => p.name_key === name_key && p.user_id !== user_id,
      )
      // UNIQUE(name_key) を実 D1 と同じく例外で知らせる（store が duplicate に畳む）。
      if (clash) throw new Error('UNIQUE constraint failed: board_profiles.name_key')
      const prev = tables.profiles.get(user_id)
      tables.profiles.set(user_id, {
        ...(prev ?? fakeProfile({ user_id, created_at })),
        display_name,
        name_key,
        updated_at,
      })
      return 1
    }
    if (sql.startsWith('UPDATE board_profiles SET banned_until')) {
      const [banned_until, updated_at, user_id] = args as [number, number, string]
      const p = tables.profiles.get(user_id)
      if (!p) return 0
      tables.profiles.set(user_id, { ...p, banned_until, updated_at })
      return 1
    }
    if (sql.startsWith('UPDATE board_profiles SET deleted_at')) {
      const [deleted_at, updated_at, user_id] = args as [number, number, string]
      const p = tables.profiles.get(user_id)
      if (!p) return 0
      tables.profiles.set(user_id, { ...p, deleted_at, updated_at })
      return 1
    }

    // --- threads ----------------------------------------------------------
    if (sql.startsWith('INSERT INTO board_threads')) {
      const [id, kind, title, user_id, created_at, bumped_at] = args as [
        string,
        string,
        string,
        string,
        number,
        number,
      ]
      if (tables.threads.has(id)) throw new Error('UNIQUE constraint failed: board_threads.id')
      tables.threads.set(id, fakeThread({ id, kind, title, user_id, created_at, bumped_at }))
      return 1
    }
    if (sql.includes('COALESCE(?, status)')) {
      const [status, status_note, shipped_version, pinned, locked, id] = args as [
        string | null,
        string | null,
        string | null,
        number | null,
        number | null,
        string,
      ]
      const t = tables.threads.get(id)
      if (!t) return 0
      tables.threads.set(id, {
        ...t,
        status: status ?? t.status,
        status_note: status_note ?? t.status_note,
        shipped_version: shipped_version ?? t.shipped_version,
        pinned: pinned ?? t.pinned,
        locked: locked ?? t.locked,
      })
      return 1
    }
    if (sql.startsWith('UPDATE board_threads SET bumped_at')) {
      const [bumped_at, , id] = args as [number, string, string]
      const t = tables.threads.get(id)
      if (!t) return 0
      tables.threads.set(id, { ...t, bumped_at, reply_count: replyCountOf(tables, id) })
      return 1
    }
    if (sql.startsWith('UPDATE board_threads SET reply_count')) {
      const id = args[1] as string
      const t = tables.threads.get(id)
      if (!t) return 0
      tables.threads.set(id, { ...t, reply_count: replyCountOf(tables, id) })
      return 1
    }
    if (sql.startsWith('UPDATE board_threads SET like_count')) {
      const id = args[1] as string
      const t = tables.threads.get(id)
      if (!t) return 0
      tables.threads.set(id, { ...t, like_count: likeCountOf(tables, id) })
      return 1
    }
    if (sql.startsWith('UPDATE board_threads SET deleted_at')) {
      const [deleted_at, id] = args as [number, string]
      // `AND user_id = ?`（スレ主の行だけ落とす）を SQL の文面どおりに再現する。
      const owner = sql.includes('AND user_id = ?') ? (args[2] as string) : null
      const t = tables.threads.get(id)
      if (!t) return 0
      if (owner !== null && t.user_id !== owner) return 0
      // WHERE ... AND deleted_at = 0（二重削除で時刻を上書きしない）を再現する。
      if (t.deleted_at !== 0) return 0
      tables.threads.set(id, { ...t, deleted_at })
      return 1
    }
    if (sql.startsWith('UPDATE board_threads SET hidden_at')) {
      const [hidden_at, id] = args as [number, string]
      const t = tables.threads.get(id)
      if (!t) return 0
      tables.threads.set(id, { ...t, hidden_at })
      return 1
    }

    // --- posts ------------------------------------------------------------
    if (sql.startsWith('INSERT INTO board_posts')) {
      const [id, thread_id, user_id, body, reply_to, created_at] = args as [
        string,
        string,
        string,
        string,
        number,
        number,
      ]
      if (tables.posts.has(id)) throw new Error('UNIQUE constraint failed: board_posts.id')
      const seq =
        [...tables.posts.values()]
          .filter((p) => p.thread_id === thread_id)
          .reduce((max, p) => Math.max(max, p.seq), 0) + 1
      // idx_board_posts_seq（thread_id, seq の UNIQUE）を再現＝採番の衝突を握り潰さない。
      const dup = [...tables.posts.values()].some((p) => p.thread_id === thread_id && p.seq === seq)
      if (dup) throw new Error('UNIQUE constraint failed: board_posts.thread_id, board_posts.seq')
      tables.posts.set(id, {
        id,
        thread_id,
        seq,
        user_id,
        body,
        reply_to,
        created_at,
        deleted_at: 0,
        hidden_at: 0,
      })
      return 1
    }
    if (sql.startsWith('UPDATE board_posts SET deleted_at')) {
      const [deleted_at, key] = args as [number, string]
      const headOnly = sql.includes('AND seq = 1')
      const byThread = sql.includes('WHERE thread_id = ?')
      // スレ削除は `AND user_id = ?` でスレ主の行だけを落とす（他人の投稿に手を触れない）。
      // 条件を落とすとフェイクだけが全投稿を消して、テストが穴を見逃す。
      const owner = sql.includes('AND user_id = ?') ? (args[2] as string) : null
      let changes = 0
      for (const p of [...tables.posts.values()]) {
        const hit = byThread
          ? p.thread_id === key &&
            (owner === null || p.user_id === owner) &&
            (!headOnly || p.seq === 1)
          : p.id === key
        if (!hit || p.deleted_at !== 0) continue
        tables.posts.set(p.id, { ...p, deleted_at })
        changes++
      }
      return changes
    }
    if (sql.startsWith('UPDATE board_posts SET hidden_at')) {
      const [hidden_at, id] = args as [number, string]
      const p = tables.posts.get(id)
      if (!p) return 0
      tables.posts.set(id, { ...p, hidden_at })
      return 1
    }

    // --- likes / polls / votes -------------------------------------------
    if (sql.startsWith('INSERT INTO board_likes')) {
      const [thread_id, user_id, created_at] = args as [string, string, number]
      const key = pairKey(thread_id, user_id)
      if (tables.likes.has(key)) return 0
      tables.likes.set(key, { thread_id, user_id, created_at })
      return 1
    }
    if (sql.startsWith('DELETE FROM board_likes')) {
      const [thread_id, user_id] = args as [string, string]
      return tables.likes.delete(pairKey(thread_id, user_id)) ? 1 : 0
    }
    if (sql.startsWith('INSERT INTO board_polls')) {
      const [thread_id, question, options, multiple, closes_at, created_at] = args as [
        string,
        string,
        string,
        number,
        number,
        number,
      ]
      if (tables.polls.has(thread_id)) {
        throw new Error('UNIQUE constraint failed: board_polls.thread_id')
      }
      tables.polls.set(thread_id, {
        thread_id,
        question,
        options,
        multiple,
        closes_at,
        created_at,
      })
      return 1
    }
    if (sql.startsWith('INSERT INTO board_votes')) {
      const [thread_id, user_id, choices, created_at] = args as [string, string, string, number]
      const key = pairKey(thread_id, user_id)
      // 1 アカウント 1 票（ON CONFLICT DO NOTHING）＝2 回目は書かず changes 0。
      if (tables.votes.has(key)) return 0
      tables.votes.set(key, { thread_id, user_id, choices, created_at })
      return 1
    }

    // --- reports ----------------------------------------------------------
    if (sql.startsWith('INSERT INTO board_reports')) {
      const [id, post_id, user_id, reason, created_at] = args as [
        string,
        string,
        string,
        string,
        number,
      ]
      tables.reports.set(id, { id, post_id, user_id, reason, created_at, handled_at: 0 })
      return 1
    }
    if (sql.startsWith('UPDATE board_reports SET handled_at')) {
      const [handled_at, id] = args as [number, string]
      const r = tables.reports.get(id)
      if (!r) return 0
      // `AND handled_at = 0`＝2 回目の処理で「いつ見たか」を上書きしない、を再現する。
      if (r.handled_at !== 0) return 0
      tables.reports.set(id, { ...r, handled_at })
      return 1
    }

    // --- links ------------------------------------------------------------
    if (sql.startsWith('INSERT INTO board_links')) {
      const [
        url_key,
        url,
        host,
        kind,
        title,
        description,
        image_url,
        image_ok,
        site_name,
        fetched_at,
        expires_at,
        blocked_at,
      ] = args as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        number,
        number,
        number,
      ]
      const prev = tables.links.get(url_key)
      tables.links.set(url_key, {
        url_key,
        url,
        host,
        kind,
        title,
        description,
        image_url,
        image_ok,
        site_name,
        fetched_at,
        expires_at,
        // 運営が潰した URL は再取得で復活させない（ON CONFLICT の SET に blocked_at が無い）。
        blocked_at: prev ? prev.blocked_at : blocked_at,
      })
      return 1
    }
    if (sql.startsWith('INSERT INTO board_post_links')) {
      const [post_id, url_key, ord] = args as [string, string, number]
      const key = pairKey(post_id, url_key)
      if (tables.postLinks.has(key)) return 0
      tables.postLinks.set(key, { post_id, url_key, ord })
      return 1
    }
    if (sql.startsWith('UPDATE board_links SET blocked_at')) {
      const [blocked_at, url_key] = args as [number, string]
      const l = tables.links.get(url_key)
      if (!l) return 0
      tables.links.set(url_key, { ...l, blocked_at })
      return 1
    }

    // --- rate_limits（checkRateLimit が使う）------------------------------
    if (sql.startsWith('INSERT INTO rate_limits')) {
      const [user_id, window_start, count] = args as [string, number, number]
      tables.rates.set(user_id, { user_id, window_start, count })
      return 1
    }

    throw new Error(`makeBoardDb: run 未対応 SQL: ${sql}`)
  }

  function makeStmt(sql: string): FakeStmt {
    const stmt: FakeStmt = {
      __sql: sql,
      __args: [],
      bind(...a: unknown[]) {
        stmt.__args = a
        return stmt
      },
      async first<T>() {
        return first(sql, stmt.__args) as T | null
      },
      async all<T>() {
        return {
          success: true as const,
          results: all(sql, stmt.__args) as T[],
          meta: { changes: 0 },
        }
      },
      async run() {
        return { success: true as const, results: [], meta: { changes: run(sql, stmt.__args) } }
      },
    }
    return stmt
  }

  const db = {
    prepare: (sql: string) => makeStmt(sql),
    // 実 D1 と同じく、SELECT でも results を返す（詳細の 6 本読みが 1 回の batch で済むように）。
    async batch(stmts: FakeStmt[]) {
      const out = []
      for (const s of stmts) {
        out.push(s.__sql.trimStart().startsWith('SELECT') ? await s.all() : await s.run())
      }
      return out
    },
  } as unknown as D1Database

  return { db, ...tables }
}

/**
 * ハンドラに渡す env。`makeBoardDb()` の戻りを `store` で渡すと、
 * テストから同じテーブルを直接シード・検証できる。
 */
export function makeBoardEnv(
  opts: {
    store?: BoardDbFake
    profiles?: ProfileRow[]
    threads?: ThreadRow[]
    posts?: PostRow[]
  } = {},
): { DB: D1Database; CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string } {
  const store = opts.store ?? makeBoardDb(opts)
  return { DB: store.db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' }
}
