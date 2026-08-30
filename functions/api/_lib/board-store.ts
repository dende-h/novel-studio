/// <reference types="@cloudflare/workers-types" />
/**
 * 掲示板の D1 アクセス層（設計 docs/requirement/09-board.md §4・§5）。
 *
 * **掲示板の SQL はすべてここに集める。エンドポイントは SQL を書かない。**
 * 既存の同期 API（functions/api/sync/work.ts）はハンドラに SQL を直書きしているが、
 * あれは 1 テーブル・数本のクエリだから成立している流儀で、掲示板には効かない。
 * こちらは 9 テーブル × 9 本のエンドポイントで、同じ行を別のハンドラが別の SQL で
 * 読む場面が必ず出る。散らかると「削除・非表示の行を除く条件」を書き忘れた 1 本から
 * 本文が漏れ（設計 §7-6）、テスト用の D1 フェイクも分岐が増えて追随できなくなる。
 * 読み書きの形をこの 1 ファイルに閉じ、フェイクもこのファイルが出す SQL だけを相手にする。
 *
 * 決めごと:
 *   * 行の型（`ThreadRow` など）は snake_case で migrations/0008_board.sql の列と同形。
 *     camelCase（`src/core/board/types.ts` の契約）への変換は、この層の `to*` だけが行う。
 *   * 時刻は epoch ms。論理削除は `0 = 生きている`。**行は消さない**
 *     （完全削除は運営の purge だけ・D-BOARD-DELETE）。
 *   * `now` は呼び出し側（ハンドラの入口）が 1 回読んだ値を受け取る。ここで `Date.now()` は呼ばない。
 *   * 集計列（`reply_count` / `like_count`）は差分加算ではなく**その場で数え直す**。
 *     加算だと失敗した書き込みや二重送信でずれ、ずれたまま誰も直せない。
 */

import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '../../../src/core/board/permission'
import { boardBodyToPlain } from '../../../src/core/board/render'
import {
  BOARD_LIMITS,
  type BoardAuthor,
  type BoardKind,
  type BoardPoll,
  type BoardPost,
  type BoardProfile,
  type BoardRole,
  type BoardStatus,
  type BoardThread,
  type BoardVote,
  type LinkCard,
  type LinkKind,
} from '../../../src/core/board/types'

// ---------------------------------------------------------------------------
// 行の型（migrations/0008_board.sql と同形）
// ---------------------------------------------------------------------------

export interface ProfileRow {
  user_id: string
  display_name: string
  name_key: string
  role: string
  banned_until: number
  deleted_at: number
  created_at: number
  updated_at: number
}

export interface ThreadRow {
  id: string
  kind: string
  title: string
  user_id: string
  status: string
  status_note: string
  shipped_version: string
  pinned: number
  locked: number
  reply_count: number
  like_count: number
  created_at: number
  bumped_at: number
  deleted_at: number
  hidden_at: number
}

export interface PostRow {
  id: string
  thread_id: string
  seq: number
  user_id: string
  body: string
  reply_to: number
  created_at: number
  deleted_at: number
  hidden_at: number
  /** 付いた 👍 の数（0009 で追加。差分加算せず数え直して入れる） */
  like_count: number
}

/**
 * 旧「スレッドへの 👍」（0008）。**0009 で投稿ごとの `board_post_likes` に移した**が、
 * 行は消していない（退避と突き合わせのため）。新しい読み書きはこの型を使わない。
 * @deprecated `PostLikeRow` を使う
 */
export interface LikeRow {
  thread_id: string
  user_id: string
  created_at: number
}

/** 投稿ごとの 👍（0009）。1 アカウント 1 回。 */
export interface PostLikeRow {
  post_id: string
  user_id: string
  created_at: number
}

export interface PollRow {
  thread_id: string
  question: string
  /** JSON 配列の文字列（["A","B"]） */
  options: string
  multiple: number
  closes_at: number
  created_at: number
}

export interface VoteRow {
  thread_id: string
  user_id: string
  /** JSON 配列の文字列（選んだ index） */
  choices: string
  created_at: number
}

export interface ReportRow {
  id: string
  post_id: string
  user_id: string
  reason: string
  created_at: number
  handled_at: number
}

export interface LinkRow {
  url_key: string
  url: string
  host: string
  kind: string
  title: string
  description: string
  image_url: string
  image_ok: number
  site_name: string
  fetched_at: number
  expires_at: number
  blocked_at: number
}

export interface PostLinkRow {
  post_id: string
  url_key: string
  ord: number
}

/**
 * 投稿者の表示に要る 3 列。**表示名は非正規化しない**（D-BOARD-NAME）ので、
 * 投稿を読むときは必ず board_profiles を JOIN して**現在の**名前を出す。
 */
export interface AuthorCols {
  author_name: string | null
  author_role: string | null
  author_deleted: number | null
}

/** 一覧用のスレ 1 行（スレ行 ＋ 本文の抜粋 ＋ 自分の 👍 ＋ アンケートの有無）。 */
export interface ThreadListRow extends ThreadRow, AuthorCols {
  /** seq=1（スレ本文）の本文。抜粋のもと */
  head_body: string | null
  head_deleted_at: number | null
  head_hidden_at: number | null
  /** アンケートが付いているか（0/1） */
  has_poll: number
  /** 閲覧者が 👍 しているか（0/1・未ログインは 0） */
  liked: number
}

/** 詳細で返す投稿 1 行（投稿 ＋ 現在の表示名 ＋ 閲覧者が 👍 しているか）。 */
export interface PostWithAuthorRow extends PostRow, AuthorCols {
  /** 閲覧者が 👍 しているか（0/1・未ログインは 0） */
  liked: number
}

/** 「自分の書き込み」タブ用（投稿 ＋ 置かれているスレの見出し）。 */
export interface MyPostRow extends PostRow {
  thread_title: string | null
  thread_kind: string | null
}

/** 運営がスレに付ける値（省略した項目は据え置き）。 */
export interface ThreadPatch {
  status?: BoardStatus
  statusNote?: string
  shippedVersion?: string
  pinned?: boolean
  locked?: boolean
}

/** スレ削除のやり方。返信があるスレは本文だけ消す（設計 §7-5）。 */
export type ThreadDeleteMode = 'whole' | 'head-only'

// ---------------------------------------------------------------------------
// 行 → 契約の型（camelCase への変換はここだけ）
// ---------------------------------------------------------------------------

/** 退会・プロフィール消失のときに出す名前（本人の名前は出さない）。 */
export const RETIRED_AUTHOR_NAME = '退会したユーザー'

const bool = (v: number | null | undefined): boolean => (v ?? 0) !== 0

const num = (v: number | null | undefined): number => v ?? 0

const str = (v: string | null | undefined): string => v ?? ''

/** JSON 配列の列を安全に読む（壊れた値で一覧ごと落とさない）。 */
function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

export function toProfile(row: ProfileRow): BoardProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: (row.role === 'staff' ? 'staff' : 'member') as BoardRole,
    bannedUntil: row.banned_until,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 投稿者の見え方。退会（`deleted_at !== 0`）と、プロフィール行が無い場合は名前を伏せる。
 * 記名式なので通常はプロフィールが必ずあるが、無い場合に素の userId が漏れる経路を作らない。
 */
export function toAuthor(row: AuthorCols): BoardAuthor {
  const retired = row.author_name === null || num(row.author_deleted) !== 0
  return {
    displayName: retired ? RETIRED_AUTHOR_NAME : str(row.author_name),
    staff: !retired && row.author_role === 'staff',
    retired,
  }
}

/** 一覧に出す抜粋。削除・非表示のスレ本文は伏字にする（設計 §7-6）。 */
function excerptOf(row: ThreadListRow): string {
  if (num(row.head_deleted_at) !== 0) return DELETED_BODY_TEXT
  if (num(row.head_hidden_at) !== 0) return HIDDEN_BODY_TEXT
  const plain = boardBodyToPlain(str(row.head_body))
  const chars = [...plain]
  if (chars.length <= BOARD_LIMITS.excerpt) return plain
  return `${chars.slice(0, BOARD_LIMITS.excerpt).join('')}…`
}

export function toThread(row: ThreadListRow, viewerId?: string | null): BoardThread {
  return {
    id: row.id,
    kind: row.kind as BoardKind,
    title: row.title,
    author: toAuthor(row),
    mine: !!viewerId && row.user_id === viewerId,
    status: row.status as BoardStatus,
    statusNote: row.status_note,
    shippedVersion: row.shipped_version,
    pinned: bool(row.pinned),
    locked: bool(row.locked),
    replyCount: row.reply_count,
    likeCount: row.like_count,
    liked: bool(row.liked),
    hasPoll: bool(row.has_poll),
    excerpt: excerptOf(row),
    createdAt: row.created_at,
    bumpedAt: row.bumped_at,
    deleted: row.deleted_at !== 0,
  }
}

/**
 * 投稿 1 件。**削除・非表示の本文はここで伏字に置き換える**（設計 §7-6）。
 * 伏せる判断を呼び出し側に委ねない＝本文が漏れる経路をこの関数 1 本に絞る。
 */
export function toPost(
  row: PostWithAuthorRow,
  opts: { viewerId?: string | null; links?: readonly LinkRow[] } = {},
): BoardPost {
  const deleted = row.deleted_at !== 0
  const hidden = row.hidden_at !== 0
  const body = deleted ? DELETED_BODY_TEXT : hidden ? HIDDEN_BODY_TEXT : row.body
  return {
    id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    author: toAuthor(row),
    mine: !!opts.viewerId && row.user_id === opts.viewerId,
    body,
    replyTo: row.reply_to,
    deleted,
    hidden,
    createdAt: row.created_at,
    likeCount: num(row.like_count),
    liked: bool(row.liked),
    // 伏せた投稿にカードを残すと、消したはずの中身がカードから読める。
    links: deleted || hidden ? [] : toLinkCards(opts.links ?? []),
  }
}

export function toPoll(row: PollRow): BoardPoll {
  return {
    threadId: row.thread_id,
    question: row.question,
    options: parseJsonArray<string>(row.options),
    multiple: bool(row.multiple),
    closesAt: row.closes_at,
    createdAt: row.created_at,
  }
}

export function toVote(row: VoteRow): BoardVote {
  return {
    threadId: row.thread_id,
    choices: parseJsonArray<number>(row.choices).filter((n) => Number.isInteger(n)),
    createdAt: row.created_at,
  }
}

/**
 * リンクカード 1 枚。`image_ok = 0`（許可表の外のホスト）なら画像は落として
 * テキストカードにする（D-BOARD-OGPIMG）。判断を画面側に持たせない。
 */
export function toLinkCard(row: LinkRow): LinkCard {
  return {
    url: row.url,
    host: row.host,
    kind: row.kind as LinkKind,
    title: row.title,
    description: row.description,
    imageUrl: num(row.image_ok) !== 0 ? row.image_url : '',
    siteName: row.site_name,
  }
}

/** カードにして良い行だけを並べる（取得に失敗した URL と、運営が潰した URL は出さない）。 */
export function toLinkCards(rows: readonly LinkRow[]): LinkCard[] {
  return rows.filter((r) => r.kind !== 'none' && num(r.blocked_at) === 0).map(toLinkCard)
}

// ---------------------------------------------------------------------------
// SQL の断片
// ---------------------------------------------------------------------------

const PROFILE_COLS = `user_id, display_name, name_key, role, banned_until, deleted_at,
       created_at, updated_at`

const THREAD_COLS = `id, kind, title, user_id, status, status_note, shipped_version, pinned,
       locked, reply_count, like_count, created_at, bumped_at, deleted_at, hidden_at`

const POST_COLS = `id, thread_id, seq, user_id, body, reply_to, created_at, deleted_at,
       hidden_at, like_count`

const LINK_COLS = `url_key, url, host, kind, title, description, image_url, image_ok,
       site_name, fetched_at, expires_at, blocked_at`

/**
 * 結合したときの `board_links` の列。**`board_post_links` にも `url_key` があるので、
 * 修飾しないと SQLite が `ambiguous column name: url_key` で落ちる。**
 * INSERT の列並び（`upsertLink`）には修飾を付けられないので、一覧を1つに保ったまま導出する。
 */
const LINK_COLS_JOINED = LINK_COLS.split(',')
  .map((col) => `l.${col.trim()}`)
  .join(', ')

/**
 * 一覧・詳細で使うスレの読み出し。**先頭の `?` は閲覧者の userId**（👍 の有無）。
 * 表示名はスレ主のプロフィールから毎回引く（非正規化しない・D-BOARD-NAME）。
 */
const THREAD_LIST_SELECT = `SELECT t.id, t.kind, t.title, t.user_id, t.status, t.status_note,
       t.shipped_version, t.pinned, t.locked, t.reply_count, t.like_count, t.created_at,
       t.bumped_at, t.deleted_at, t.hidden_at,
       hp.body AS head_body, hp.deleted_at AS head_deleted_at, hp.hidden_at AS head_hidden_at,
       pr.display_name AS author_name, pr.role AS author_role, pr.deleted_at AS author_deleted,
       (SELECT COUNT(*) FROM board_polls po WHERE po.thread_id = t.id) AS has_poll,
       (SELECT COUNT(*) FROM board_post_likes lk
          WHERE lk.post_id = hp.id AND lk.user_id = ?) AS liked
FROM board_threads t
LEFT JOIN board_posts hp ON hp.thread_id = t.id AND hp.seq = 1
LEFT JOIN board_profiles pr ON pr.user_id = t.user_id`

/** 返信の件数を数え直す式（スレ本文 seq=1 は含めない・伏せた投稿も含めない）。 */
const REPLY_COUNT_EXPR = `(SELECT COUNT(*) FROM board_posts rc
     WHERE rc.thread_id = ? AND rc.seq > 1 AND rc.deleted_at = 0 AND rc.hidden_at = 0)`

/** 投稿 1 件に付いた 👍 を数え直す式（引数は post_id）。 */
const POST_LIKE_COUNT_EXPR = `(SELECT COUNT(*) FROM board_post_likes lc WHERE lc.post_id = ?)`

/**
 * スレ行に持つ `like_count` を数え直す式（引数は thread_id）。
 * **スレ本文（seq=1）に付いた 👍 の数**で、一覧の賛同数はこれを出す（0009）。
 */
const THREAD_LIKE_COUNT_EXPR = `(SELECT COALESCE(MAX(hp.like_count), 0) FROM board_posts hp
     WHERE hp.thread_id = ? AND hp.seq = 1)`

const placeholders = (n: number): string => new Array(n).fill('?').join(', ')

const rowsOf = <T>(res: { results?: unknown[] } | undefined): T[] =>
  (res?.results ?? []) as unknown as T[]

const changesOf = (res: { meta?: { changes?: number } } | undefined): number =>
  res?.meta?.changes ?? 0

// ---------------------------------------------------------------------------
// プロフィール
// ---------------------------------------------------------------------------

export async function readProfile(db: D1Database, userId: string): Promise<ProfileRow | null> {
  return await db
    .prepare(`SELECT ${PROFILE_COLS} FROM board_profiles WHERE user_id = ?`)
    .bind(userId)
    .first<ProfileRow>()
}

/**
 * 表示名の登録・改名（D-BOARD-NAME）。
 * `name_key` が他人と重なれば `duplicate`。事前 SELECT で弾いたうえで、
 * 同時登録がすり抜けたときは UNIQUE 制約の例外も同じ `duplicate` に畳む。
 * **role / banned_until / deleted_at は触らない**（1 欄の更新で他の欄を落とさない）。
 */
export async function upsertProfile(
  db: D1Database,
  input: { userId: string; displayName: string; nameKey: string; now: number },
): Promise<{ ok: true } | { ok: false; reason: 'duplicate' }> {
  const taken = await db
    .prepare('SELECT user_id FROM board_profiles WHERE name_key = ?')
    .bind(input.nameKey)
    .first<{ user_id: string }>()
  if (taken && taken.user_id !== input.userId) return { ok: false, reason: 'duplicate' }

  try {
    await db
      .prepare(
        `INSERT INTO board_profiles
           (user_id, display_name, name_key, role, banned_until, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'member', 0, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = excluded.display_name,
           name_key     = excluded.name_key,
           updated_at   = excluded.updated_at`,
      )
      .bind(input.userId, input.displayName, input.nameKey, input.now, input.now)
      .run()
  } catch {
    // UNIQUE(name_key) 違反＝同じ名前が同時に登録された。理由は事前 SELECT と揃える。
    return { ok: false, reason: 'duplicate' }
  }
  return { ok: true }
}

/** 投稿禁止の期限を入れる（0 で解除）。 */
export async function setBan(
  db: D1Database,
  userId: string,
  bannedUntil: number,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE board_profiles SET banned_until = ?, updated_at = ? WHERE user_id = ?')
    .bind(bannedUntil, now, userId)
    .run()
}

/** 退会。**投稿は消さず**、表示名だけ伏せる（会話が虫食いにならないように）。 */
export async function markProfileDeleted(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE board_profiles SET deleted_at = ?, updated_at = ? WHERE user_id = ?')
    .bind(now, now, userId)
    .run()
}

// ---------------------------------------------------------------------------
// スレッド
// ---------------------------------------------------------------------------

/** 一覧のカーソル。`pinned` を含めるのは、ピン留めを跨いだときに取りこぼさないため。 */
interface ThreadCursor {
  pinned: number
  bumpedAt: number
  id: string
}

const encodeCursor = (row: ThreadRow): string => `${row.pinned}:${row.bumped_at}:${row.id}`

function decodeCursor(raw: string | null | undefined): ThreadCursor | null {
  if (!raw) return null
  const m = /^(\d+):(\d+):(.+)$/.exec(raw)
  // 壊れたカーソルは無視して先頭から返す（400 にして一覧ごと落とさない）。
  if (!m?.[3]) return null
  return { pinned: Number(m[1]), bumpedAt: Number(m[2]), id: m[3] }
}

/**
 * 一覧（設計 §2）。並びは `pinned DESC, bumped_at DESC, id DESC` で、
 * カーソルは 3 つの複合＝同時刻のスレが 2 本あってもページ境界で落ちない。
 * 削除・非表示の行は返さない（本文どころか見出しも出さない）。
 */
export async function listThreads(
  db: D1Database,
  opts: {
    /** 1 種別だけ絞る。`kinds` と併用しない */
    kind?: BoardKind | null
    /**
     * 複数種別を絞る（要望タブが旧 `suggestion` も拾うため）。
     * **JS 側で引いた行を後から捨てない**——捨てると 1 ページが空になっても
     * `nextCursor` だけ返り、画面が「空なのに『もっと読む』」になる。
     */
    kinds?: readonly BoardKind[] | null
    cursor?: string | null
    limit?: number
    viewerId?: string | null
  } = {},
): Promise<{ rows: ThreadListRow[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100))
  const cursor = decodeCursor(opts.cursor)
  const args: unknown[] = [opts.viewerId ?? null]

  let sql = `${THREAD_LIST_SELECT}\nWHERE t.deleted_at = 0 AND t.hidden_at = 0`
  const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : opts.kind ? [opts.kind] : null
  if (kinds) {
    sql += `\n  AND t.kind IN (${placeholders(kinds.length)})`
    args.push(...kinds)
  }
  if (cursor) {
    sql += `\n  AND (t.pinned < ?
       OR (t.pinned = ? AND t.bumped_at < ?)
       OR (t.pinned = ? AND t.bumped_at = ? AND t.id < ?))`
    args.push(
      cursor.pinned,
      cursor.pinned,
      cursor.bumpedAt,
      cursor.pinned,
      cursor.bumpedAt,
      cursor.id,
    )
  }
  // 1 件多く取って「次があるか」を見る（COUNT を別に投げない）。
  sql += '\nORDER BY t.pinned DESC, t.bumped_at DESC, t.id DESC\nLIMIT ?'
  args.push(limit + 1)

  const res = await db
    .prepare(sql)
    .bind(...args)
    .all<ThreadListRow>()
  const all = rowsOf<ThreadListRow>(res)
  const rows = all.slice(0, limit)
  const last = rows[rows.length - 1]
  const nextCursor = all.length > limit && last ? encodeCursor(last) : null
  return { rows, nextCursor }
}

/** スレ 1 行を素のまま引く（削除・非表示も返す＝呼び出し側が 404 と権限を判断する）。 */
export async function readThread(db: D1Database, threadId: string): Promise<ThreadRow | null> {
  return await db
    .prepare(`SELECT ${THREAD_COLS} FROM board_threads WHERE id = ?`)
    .bind(threadId)
    .first<ThreadRow>()
}

/**
 * スレ 1 本の詳細。**1 回の `db.batch()` で 6 本まとめて読む**（N+1 を作らない）。
 * リンクカードは投稿ごとに引かず、スレを軸に JOIN して 1 本の SELECT で取る。
 */
export async function readThreadDetail(
  db: D1Database,
  threadId: string,
  viewerId?: string | null,
): Promise<{
  thread: ThreadListRow
  posts: PostWithAuthorRow[]
  poll: PollRow | null
  myVote: VoteRow | null
  votes: VoteRow[]
  links: Map<string, LinkRow[]>
} | null> {
  const viewer = viewerId ?? null
  const res = await db.batch([
    db.prepare(`${THREAD_LIST_SELECT}\nWHERE t.id = ?`).bind(viewer, threadId),
    db
      .prepare(
        `SELECT p.id, p.thread_id, p.seq, p.user_id, p.body, p.reply_to, p.created_at,
                p.deleted_at, p.hidden_at, p.like_count,
                pr.display_name AS author_name, pr.role AS author_role,
                pr.deleted_at AS author_deleted,
                (SELECT COUNT(*) FROM board_post_likes lk
                   WHERE lk.post_id = p.id AND lk.user_id = ?) AS liked
         FROM board_posts p
         LEFT JOIN board_profiles pr ON pr.user_id = p.user_id
         WHERE p.thread_id = ?
         ORDER BY p.seq ASC`,
      )
      .bind(viewer, threadId),
    db
      .prepare(
        'SELECT thread_id, question, options, multiple, closes_at, created_at FROM board_polls WHERE thread_id = ?',
      )
      .bind(threadId),
    db
      .prepare(
        'SELECT thread_id, user_id, choices, created_at FROM board_votes WHERE thread_id = ? AND user_id = ?',
      )
      .bind(threadId, viewer),
    db
      .prepare(
        'SELECT thread_id, user_id, choices, created_at FROM board_votes WHERE thread_id = ?',
      )
      .bind(threadId),
    db
      .prepare(
        `SELECT pl.post_id AS post_id, ${LINK_COLS_JOINED}
         FROM board_post_links pl
         JOIN board_links l ON l.url_key = pl.url_key
         JOIN board_posts p ON p.id = pl.post_id
         WHERE p.thread_id = ?
         ORDER BY pl.post_id ASC, pl.ord ASC`,
      )
      .bind(threadId),
  ])

  const thread = rowsOf<ThreadListRow>(res[0])[0]
  if (!thread) return null

  const links = new Map<string, LinkRow[]>()
  for (const row of rowsOf<LinkRow & { post_id: string }>(res[5])) {
    const list = links.get(row.post_id)
    if (list) list.push(row)
    else links.set(row.post_id, [row])
  }

  return {
    thread,
    posts: rowsOf<PostWithAuthorRow>(res[1]),
    poll: rowsOf<PollRow>(res[2])[0] ?? null,
    myVote: rowsOf<VoteRow>(res[3])[0] ?? null,
    votes: rowsOf<VoteRow>(res[4]),
    links,
  }
}

/** スレ行を作る。本文（seq=1）は `createPost` で別に入れる（設計 §4）。 */
export async function createThread(
  db: D1Database,
  input: { id: string; kind: BoardKind; title: string; userId: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_threads
         (id, kind, title, user_id, status, status_note, shipped_version, pinned, locked,
          reply_count, like_count, created_at, bumped_at, deleted_at, hidden_at)
       VALUES (?, ?, ?, ?, '', '', '', 0, 0, 0, 0, ?, ?, 0, 0)`,
    )
    .bind(input.id, input.kind, input.title, input.userId, input.now, input.now)
    .run()
}

/**
 * 運営がステータス・ピン・ロックを変える（staff のみ・判定は呼び出し側）。
 * 省略した項目は `COALESCE` で据え置く＝1 欄の更新で他の欄を落とさない。
 * 第 4 引数の `now` は署名の互換のために受けるが、`board_threads` に更新時刻の列は無い
 * （列を足すと旧レコードの読み出しに影響するので足さない）。
 */
export async function patchThread(
  db: D1Database,
  threadId: string,
  patch: ThreadPatch,
  _now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE board_threads SET
         status          = COALESCE(?, status),
         status_note     = COALESCE(?, status_note),
         shipped_version = COALESCE(?, shipped_version),
         pinned          = COALESCE(?, pinned),
         locked          = COALESCE(?, locked)
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? null,
      patch.statusNote ?? null,
      patch.shippedVersion ?? null,
      patch.pinned === undefined ? null : patch.pinned ? 1 : 0,
      patch.locked === undefined ? null : patch.locked ? 1 : 0,
      threadId,
    )
    .run()
}

/** 最終書き込み時刻を進め、返信数を数え直す（新着順にしない・設計 §2）。 */
export async function bumpThread(db: D1Database, threadId: string, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE board_threads SET bumped_at = ?, reply_count = ${REPLY_COUNT_EXPR} WHERE id = ?`,
    )
    .bind(now, threadId, threadId)
    .run()
}

/**
 * スレの論理削除（D-BOARD-DELETE）。**行は消さない。**
 *   'whole'     … 返信 0 のスレ。スレ行とスレ主の投稿に `deleted_at` を入れる
 *   'head-only' … 返信があるスレ。**seq=1 の本文だけ**消し、他人の返信は残す（設計 §7-5）
 *
 * **触れるのは `ownerUserId` の行だけ**（3 本すべてに `AND user_id = ?` を付ける）。
 * これは本人の削除であって運営の措置ではないので、他人の行に `deleted_at` を刻んではいけない。
 * 以前は `WHERE thread_id = ? AND deleted_at = 0` で全投稿を落としていたため、
 * staff が伏せた他人の返信（`hidden_at != 0`・`deleted_at = 0`）にも `deleted_at` が入り、
 * `unhide_post` しても「この投稿は削除されました」のまま戻らなかった＝運営の措置が
 * 不可逆になり、「消えたのが本人の意思か運営の判断か」を後から取り違えられた。
 * どの mode でも規則は 1 つ「消していいのは本人の行だけ」に揃える。
 */
export async function softDeleteThread(
  db: D1Database,
  threadId: string,
  mode: ThreadDeleteMode,
  now: number,
  ownerUserId: string,
): Promise<void> {
  // 呼び忘れの保険。`functions/` は tsconfig の include（`["src", ...]`）に入っていないので、
  // 引数を増やしても `pnpm typecheck` は気づかない。undefined を黙って bind すると
  // `user_id = NULL` で 1 行も当たらず、「削除したのに消えない」に化ける。止まるほうを選ぶ。
  if (typeof ownerUserId !== 'string' || ownerUserId === '') {
    throw new TypeError('softDeleteThread にはスレ主の userId を渡す（消せるのは本人の行だけ）')
  }
  if (mode === 'head-only') {
    await db
      .prepare(
        `UPDATE board_posts SET deleted_at = ?
         WHERE thread_id = ? AND user_id = ? AND seq = 1 AND deleted_at = 0`,
      )
      .bind(now, threadId, ownerUserId)
      .run()
    return
  }
  await db.batch([
    db
      .prepare(
        'UPDATE board_threads SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at = 0',
      )
      .bind(now, threadId, ownerUserId),
    db
      .prepare(
        `UPDATE board_posts SET deleted_at = ?
         WHERE thread_id = ? AND user_id = ? AND deleted_at = 0`,
      )
      .bind(now, threadId, ownerUserId),
  ])
}

/** 運営の非表示（スレごと伏せる）。投稿の行はそのまま残す。 */
export async function hideThread(db: D1Database, threadId: string, now: number): Promise<void> {
  await db.prepare('UPDATE board_threads SET hidden_at = ? WHERE id = ?').bind(now, threadId).run()
}

// ---------------------------------------------------------------------------
// 投稿
// ---------------------------------------------------------------------------

export async function readPost(db: D1Database, postId: string): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${POST_COLS} FROM board_posts WHERE id = ?`)
    .bind(postId)
    .first<PostRow>()
}

/**
 * スレ本文（seq=1）の投稿。👍 が投稿ごとになった今も、外から来る古い呼び方
 *（`POST /api/board/like?thread=`）は「スレに賛同する」＝本文への 👍 として受ける。
 * その写し替えをこの 1 本に閉じる。
 */
export async function readHeadPost(db: D1Database, threadId: string): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${POST_COLS} FROM board_posts WHERE thread_id = ? AND seq = 1`)
    .bind(threadId)
    .first<PostRow>()
}

/**
 * 投稿を 1 件足す。**seq の採番は `INSERT ... SELECT COALESCE(MAX(seq),0)+1` の 1 文**で行う。
 * 読んでから書くと同時投稿で同じ番号を取り合う。すり抜けても
 * `idx_board_posts_seq`（thread_id, seq の UNIQUE）が最後の砦になり、
 * 2 本目は例外で落ちる＝番号が重なった行は生まれない。
 */
export async function createPost(
  db: D1Database,
  input: {
    id: string
    threadId: string
    userId: string
    body: string
    replyTo?: number
    now: number
  },
): Promise<{ seq: number }> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO board_posts
           (id, thread_id, seq, user_id, body, reply_to, created_at, deleted_at, hidden_at)
         SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, 0, 0
         FROM board_posts WHERE thread_id = ?`,
      )
      .bind(
        input.id,
        input.threadId,
        input.userId,
        input.body,
        input.replyTo ?? 0,
        input.now,
        input.threadId,
      ),
    db
      .prepare(
        `UPDATE board_threads SET bumped_at = ?, reply_count = ${REPLY_COUNT_EXPR} WHERE id = ?`,
      )
      .bind(input.now, input.threadId, input.threadId),
  ])

  const row = await db
    .prepare('SELECT seq FROM board_posts WHERE id = ?')
    .bind(input.id)
    .first<{ seq: number }>()
  return { seq: row?.seq ?? 0 }
}

/** 本人による投稿の削除。本文は残したまま伏字で返す（行は消さない）。返信数も数え直す。 */
export async function softDeletePost(db: D1Database, postId: string, now: number): Promise<void> {
  const post = await readPost(db, postId)
  if (!post) return
  await db.batch([
    db
      .prepare('UPDATE board_posts SET deleted_at = ? WHERE id = ? AND deleted_at = 0')
      .bind(now, postId),
    db
      .prepare(`UPDATE board_threads SET reply_count = ${REPLY_COUNT_EXPR} WHERE id = ?`)
      .bind(post.thread_id, post.thread_id),
  ])
}

/** 運営の非表示・解除（`hiddenAt = 0` で解除）。返信数は伏せた投稿を数えないので数え直す。 */
export async function setPostHidden(
  db: D1Database,
  postId: string,
  hiddenAt: number,
): Promise<void> {
  const post = await readPost(db, postId)
  if (!post) return
  await db.batch([
    db.prepare('UPDATE board_posts SET hidden_at = ? WHERE id = ?').bind(hiddenAt, postId),
    db
      .prepare(`UPDATE board_threads SET reply_count = ${REPLY_COUNT_EXPR} WHERE id = ?`)
      .bind(post.thread_id, post.thread_id),
  ])
}

/** 「自分の書き込み」タブ。新しい順。スレの見出しも一緒に取る（一覧で N+1 を作らない）。 */
export async function listPostsByUser(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<MyPostRow[]> {
  const res = await db
    .prepare(
      `SELECT p.id, p.thread_id, p.seq, p.user_id, p.body, p.reply_to, p.created_at,
              p.deleted_at, p.hidden_at, p.like_count,
              t.title AS thread_title, t.kind AS thread_kind
       FROM board_posts p
       LEFT JOIN board_threads t ON t.id = p.thread_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, Math.max(1, Math.min(limit, 200)))
    .all<MyPostRow>()
  return rowsOf<MyPostRow>(res)
}

// ---------------------------------------------------------------------------
// 👍 / アンケート
// ---------------------------------------------------------------------------

/**
 * 👍 のトグル（**投稿ごと**・0009）。`board_post_likes` の有無で分岐し、
 * **同じ batch で `like_count` を数え直す**。加算・減算にすると、二重送信や失敗した
 * 書き込みでずれて誰も直せなくなる。
 *
 * 数え直すのは 2 つ。投稿の `like_count` と、その投稿がスレ本文（seq=1）だったときの
 * スレ行の `like_count`（一覧に出す賛同数）。本文以外への 👍 ではスレ行は動かない。
 */
export async function toggleLike(
  db: D1Database,
  post: Pick<PostRow, 'id' | 'thread_id' | 'seq'>,
  userId: string,
  now: number,
): Promise<{ liked: boolean; likeCount: number }> {
  // 呼び忘れの保険。`functions/` は tsconfig の include に入っていない＝引数の形を変えても
  // `pnpm typecheck` は気づかない。post_id のつもりでスレ id を渡すと、当たらない行を
  // 数え続けて「押しても増えない 👍」になる。止まるほうを選ぶ。
  if (typeof post !== 'object' || post === null || typeof post.id !== 'string') {
    throw new TypeError('toggleLike には投稿の行を渡す（👍 が付く相手はスレッドではなく投稿）')
  }
  const existing = await db
    .prepare('SELECT post_id FROM board_post_likes WHERE post_id = ? AND user_id = ?')
    .bind(post.id, userId)
    .first<{ post_id: string }>()
  const liked = !existing

  const statements = [
    liked
      ? db
          .prepare(
            `INSERT INTO board_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)
             ON CONFLICT(post_id, user_id) DO NOTHING`,
          )
          .bind(post.id, userId, now)
      : db
          .prepare('DELETE FROM board_post_likes WHERE post_id = ? AND user_id = ?')
          .bind(post.id, userId),
    db
      .prepare(`UPDATE board_posts SET like_count = ${POST_LIKE_COUNT_EXPR} WHERE id = ?`)
      .bind(post.id, post.id),
  ]
  // 本文への 👍 だけスレ行へ写す（一覧の賛同数はスレ行から読む）。
  if (post.seq === 1) {
    statements.push(
      db
        .prepare(`UPDATE board_threads SET like_count = ${THREAD_LIKE_COUNT_EXPR} WHERE id = ?`)
        .bind(post.thread_id, post.thread_id),
    )
  }
  await db.batch(statements)

  const row = await db
    .prepare('SELECT like_count FROM board_posts WHERE id = ?')
    .bind(post.id)
    .first<{ like_count: number }>()
  return { liked, likeCount: row?.like_count ?? 0 }
}

export async function readPoll(db: D1Database, threadId: string): Promise<PollRow | null> {
  return await db
    .prepare(
      'SELECT thread_id, question, options, multiple, closes_at, created_at FROM board_polls WHERE thread_id = ?',
    )
    .bind(threadId)
    .first<PollRow>()
}

/** アンケートはスレに 1 つまで（`thread_id` が主キー）。選択肢は JSON 配列で持つ。 */
export async function createPoll(
  db: D1Database,
  input: {
    threadId: string
    question: string
    options: readonly string[]
    multiple: boolean
    closesAt: number
    now: number
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_polls (thread_id, question, options, multiple, closes_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.threadId,
      input.question,
      JSON.stringify([...input.options]),
      input.multiple ? 1 : 0,
      input.closesAt,
      input.now,
    )
    .run()
}

export async function readVote(
  db: D1Database,
  threadId: string,
  userId: string,
): Promise<VoteRow | null> {
  return await db
    .prepare(
      'SELECT thread_id, user_id, choices, created_at FROM board_votes WHERE thread_id = ? AND user_id = ?',
    )
    .bind(threadId, userId)
    .first<VoteRow>()
}

export async function listVotes(db: D1Database, threadId: string): Promise<VoteRow[]> {
  const res = await db
    .prepare('SELECT thread_id, user_id, choices, created_at FROM board_votes WHERE thread_id = ?')
    .bind(threadId)
    .all<VoteRow>()
  return rowsOf<VoteRow>(res)
}

/**
 * 1 票入れる。**1 アカウント 1 票**なので 2 回目は書かずに `false` を返す（上書きしない）。
 * `ON CONFLICT DO NOTHING` の書き込み行数で判定する＝同時に 2 回押されても片方だけ通る。
 */
export async function insertVote(
  db: D1Database,
  input: { threadId: string; userId: string; choices: readonly number[]; now: number },
): Promise<{ ok: boolean }> {
  const res = await db
    .prepare(
      `INSERT INTO board_votes (thread_id, user_id, choices, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id, user_id) DO NOTHING`,
    )
    .bind(input.threadId, input.userId, JSON.stringify([...input.choices]), input.now)
    .run()
  return { ok: changesOf(res) > 0 }
}

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

const REPORT_COLS = 'id, post_id, user_id, reason, created_at, handled_at'

/** 通報を運営のキューに積むだけ（件数による自動非表示はしない・D-BOARD-REPORT）。 */
export async function insertReport(
  db: D1Database,
  input: { id: string; postId: string; userId: string; reason: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_reports (id, post_id, user_id, reason, created_at, handled_at)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .bind(input.id, input.postId, input.userId, input.reason, input.now)
    .run()
}

/**
 * 未処理の通報を**古い順に**返す（D-BOARD-REPORT の「運営は 1 日 1 回キューを見る」）。
 * 積むだけで読めないと運営作業が D1 への直クエリになるので、読み口をここに置く。
 *
 * 並びは `created_at ASC, id ASC`＝`idx_board_reports_open (handled_at, created_at)` に乗る形。
 * 同時刻の通報でも順序が揺れないよう id を第 2 キーに入れる（キューを 2 回開いて
 * 並びが変わると、上から順に片付ける運用が成り立たない）。
 * **通報者（`user_id`）を含む生の行を返す**ので、公開レスポンスに素通しにしないこと
 *（通報したことは相手にも第三者にも見せない・設計 §5）。
 */
export async function listOpenReports(db: D1Database, limit: number): Promise<ReportRow[]> {
  const res = await db
    .prepare(
      `SELECT ${REPORT_COLS} FROM board_reports WHERE handled_at = 0
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(limit, 200)))
    .all<ReportRow>()
  return rowsOf<ReportRow>(res)
}

/**
 * 通報を「見た」印を付けてキューから外す。処理できた（＝キューに在った）なら true。
 * `AND handled_at = 0` を付けるのは、2 回目の処理で時刻を上書きしないため＝
 * 「いつ運営が見たか」が後から書き換わらない（措置の記録を過去に遡って動かさない）。
 * 存在しない id も false になるので、呼び出し側はこれで 404 を判断できる。
 */
export async function markReportHandled(
  db: D1Database,
  reportId: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE board_reports SET handled_at = ? WHERE id = ? AND handled_at = 0')
    .bind(now, reportId)
    .run()
  return changesOf(res) > 0
}

// ---------------------------------------------------------------------------
// リンクカード
// ---------------------------------------------------------------------------

/** キャッシュ済みのリンクを引く（期限の判定は呼び出し側＝取得の責務）。 */
export async function readLinks(db: D1Database, urlKeys: readonly string[]): Promise<LinkRow[]> {
  if (urlKeys.length === 0) return []
  const res = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM board_links WHERE url_key IN (${placeholders(urlKeys.length)})`,
    )
    .bind(...urlKeys)
    .all<LinkRow>()
  return rowsOf<LinkRow>(res)
}

/**
 * 取得結果をキャッシュに入れる（D-BOARD-OGPCACHE）。
 * `blocked_at` は上書きしない＝運営が潰した URL が、再取得で勝手に復活しない。
 */
export async function upsertLink(db: D1Database, row: LinkRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_links
         (${LINK_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url_key) DO UPDATE SET
         url         = excluded.url,
         host        = excluded.host,
         kind        = excluded.kind,
         title       = excluded.title,
         description = excluded.description,
         image_url   = excluded.image_url,
         image_ok    = excluded.image_ok,
         site_name   = excluded.site_name,
         fetched_at  = excluded.fetched_at,
         expires_at  = excluded.expires_at`,
    )
    .bind(
      row.url_key,
      row.url,
      row.host,
      row.kind,
      row.title,
      row.description,
      row.image_url,
      row.image_ok,
      row.site_name,
      row.fetched_at,
      row.expires_at,
      row.blocked_at,
    )
    .run()
}

/** 投稿とリンクを結ぶ（本文での出現順を `ord` に持つ）。 */
export async function linkPost(
  db: D1Database,
  postId: string,
  urlKeys: readonly string[],
): Promise<void> {
  if (urlKeys.length === 0) return
  await db.batch(
    urlKeys.map((key, i) =>
      db
        .prepare(
          `INSERT INTO board_post_links (post_id, url_key, ord) VALUES (?, ?, ?)
           ON CONFLICT(post_id, url_key) DO NOTHING`,
        )
        .bind(postId, key, i),
    ),
  )
}

/** 投稿 id → リンク行。**1 本の SELECT** でまとめて引く（投稿ごとに引かない）。 */
export async function readPostLinks(
  db: D1Database,
  postIds: readonly string[],
): Promise<Map<string, LinkRow[]>> {
  const out = new Map<string, LinkRow[]>()
  if (postIds.length === 0) return out
  const res = await db
    .prepare(
      // 列は必ず `l.` で修飾する（`LINK_COLS_JOINED`）。board_post_links にも url_key があり、
      // 素の `LINK_COLS` に戻すと SQLite が `ambiguous column name: url_key` で落ちる
      // ＝スレを開くと 500。readThreadDetail の同じ結合で実際に起きた事故なので、
      // 修飾を外さないこと（functions/api/_lib/board-store.real.test.ts が実 SQLite で見張る）。
      `SELECT pl.post_id AS post_id, ${LINK_COLS_JOINED}
       FROM board_post_links pl
       JOIN board_links l ON l.url_key = pl.url_key
       WHERE pl.post_id IN (${placeholders(postIds.length)})
       ORDER BY pl.post_id ASC, pl.ord ASC`,
    )
    .bind(...postIds)
    .all<LinkRow & { post_id: string }>()
  for (const row of rowsOf<LinkRow & { post_id: string }>(res)) {
    const list = out.get(row.post_id)
    if (list) list.push(row)
    else out.set(row.post_id, [row])
  }
  return out
}

/** 運営が URL 単位でカードを潰す（投稿は残したまま・設計 §3.2）。 */
export async function blockLink(db: D1Database, urlKey: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE board_links SET blocked_at = ? WHERE url_key = ?')
    .bind(now, urlKey)
    .run()
}

// ---------------------------------------------------------------------------
// レート制限の補助（D-BOARD-OPEN: スレ 3 本/日・投稿 10 件/時）
// ---------------------------------------------------------------------------

/**
 * `since` 以降にこの人が立てたスレの本数。
 * **削除済みも数える**（消して立て直せば上限を無視できる、という抜け道を作らない）。
 */
export async function countThreadsSince(
  db: D1Database,
  userId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM board_threads WHERE user_id = ? AND created_at >= ?')
    .bind(userId, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** `since` 以降にこの人が書いた投稿の件数（スレ本文 seq=1 も 1 件として数える）。 */
export async function countPostsSince(
  db: D1Database,
  userId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM board_posts WHERE user_id = ? AND created_at >= ?')
    .bind(userId, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}
