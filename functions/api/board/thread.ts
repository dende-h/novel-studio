/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/thread — スレッド 1 本を扱う（設計 docs/requirement/09-board.md §5）。
 * 単体の指定は `functions/api/sync/work.ts` と同じ `?id=` クエリ。
 *   GET    = 詳細（投稿・アンケート・リンクカード同梱）。**未ログインでも 200**（§2・§7-1）。
 *   PATCH  = 運営ステータス／ピン／ロック（**staff のみ**・§5）。省略した項目は据え置き。
 *   DELETE = 自分のスレ。**返信があれば本文だけ消して返信は残す**（§7-5）。
 *
 * ここで SQL は書かない。読み書きは `functions/api/_lib/board-store.ts`、
 * 権限は `src/core/board/permission.ts`、開示判定は `src/core/board/poll.ts` に閉じてある。
 * このファイルの仕事は**判断を HTTP に写すことだけ**で、判断そのものは持たない。
 *
 * 本文が漏れる経路を作らないための決めごと（§7-6）:
 *   投稿は必ず `visiblePost` を通し、削除・非表示なら伏字に置き換えた本文だけを
 *   `toPost` へ渡す。store 側の `toPost` も同じ伏字化をするが、**伏せる判断を
 *   2 つの層で独立に効かせる**（片方の分岐を将来だれかが緩めても本文は出ない）。
 *
 * 票数は `pollResultFor` を通して組み立てる（§7-7）。未投票かつ締切前は counts / total が
 * null で返り、0 埋めにして「0 票」と誤読させることもしない。
 *
 * `Date.now()` は各ハンドラの入口で 1 回だけ読み、以降は引数で回す（同じリクエストの中で
 * 時刻がずれない・テストから固定できる）。
 */

import {
  type Actor,
  canDeleteThread,
  canModerate,
  canPost,
  canSetStatus,
  type PermissionResult,
  STATUS_OF_REASON,
  type ThreadLike,
  threadDeleteMode,
  visiblePost,
} from '../../../src/core/board/permission'
import { pollResultFor } from '../../../src/core/board/poll'
import { BOARD_LIMITS, ThreadPatchInputSchema } from '../../../src/core/board/types'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import {
  type PostWithAuthorRow,
  type ProfileRow,
  patchThread,
  readProfile,
  readThread,
  readThreadDetail,
  softDeleteThread,
  type ThreadRow,
  toPoll,
  toPost,
  toThread,
  toVote,
} from '../_lib/board-store'
import { checkRateLimit } from '../_lib/rate-limit'

interface Env extends ClerkEnv {
  DB: D1Database
}

/**
 * 閲覧者の userId（未ログインは null）。
 * **認証の失敗で詳細を落とさない**＝読むのは誰でもできる（§2）。期限切れのセッションを
 * 持ったまま覗きに来た読者に 500 を返すと、スレが真っ白になる。
 */
async function viewerIdOf(request: Request, env: Env): Promise<string | null> {
  try {
    return await verifyUserId(request, env)
  } catch {
    return null
  }
}

/** `?id=`。無ければ 400（work.ts と同じ流儀）。 */
const threadIdOf = (request: Request): string | null => new URL(request.url).searchParams.get('id')

/** 権限判断に要るぶんだけのスレ（`ThreadListRow` も `ThreadRow` を満たすので両方通る）。 */
const threadLikeOf = (row: ThreadRow): ThreadLike => ({
  userId: row.user_id,
  kind: row.kind,
  locked: row.locked,
  replyCount: row.reply_count,
  deletedAt: row.deleted_at,
  hiddenAt: row.hidden_at,
})

/**
 * 判断の主体。プロフィール行が無い＝表示名が未設定なので、既定の member 扱いにする
 * （書き込みの 409 は投稿系のエンドポイントの仕事で、ここでは権限だけを見る）。
 */
const actorOf = (userId: string | null, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/** 拒否理由を HTTP に写す。対応表は permission.ts の 1 つだけを引く。 */
const denied = (result: PermissionResult & { ok: false }): Response =>
  json({ error: result.reason }, STATUS_OF_REASON[result.reason])

/**
 * 投稿 1 件を表示用へ。**先に `visiblePost` で本文を伏字へ落としてから** `toPost` に渡す。
 * こうしておくと、この関数より下流のどこにも生の本文が流れない。
 */
function toVisiblePost(row: PostWithAuthorRow, opts: Parameters<typeof toPost>[1]) {
  const masked = visiblePost({
    userId: row.user_id,
    body: row.body,
    deletedAt: row.deleted_at,
    hiddenAt: row.hidden_at,
  })
  return toPost({ ...row, body: masked.body }, opts)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const threadId = threadIdOf(context.request)
  if (!threadId) return json({ error: 'missing_id' }, 400)

  const viewerId = await viewerIdOf(context.request, context.env)
  const detail = await readThreadDetail(db, threadId, viewerId)
  if (!detail) return json({ error: 'not_found' }, 404)

  // 削除済み・運営が非表示にしたスレは、見出しごと出さない（一覧の条件と揃える）。
  if (detail.thread.deleted_at !== 0 || detail.thread.hidden_at !== 0) {
    return json({ error: 'not_found' }, 404)
  }

  // 書き込めるかの判定にプロフィール（立場と投稿禁止）が要る。未ログインなら引かない。
  const profile = viewerId ? await readProfile(db, viewerId) : null
  const actor = actorOf(viewerId, profile)

  const posts = detail.posts.map((row) =>
    toVisiblePost(row, { viewerId, links: detail.links.get(row.id) }),
  )

  // アンケートの開示規則は pollResultFor の中だけにある（§7-7）。
  const poll = detail.poll
    ? pollResultFor(
        toPoll(detail.poll),
        detail.votes.map(toVote),
        detail.myVote ? toVote(detail.myVote) : null,
        now,
      )
    : null

  return json({
    thread: toThread(detail.thread, viewerId),
    posts,
    poll,
    canPost: canPost(actor, threadLikeOf(detail.thread), now).ok,
  })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const threadId = threadIdOf(context.request)
  if (!threadId) return json({ error: 'missing_id' }, 400)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const parsed = ThreadPatchInputSchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'bad_request' }, 400)
  const patch = parsed.data

  const row = await readThread(db, threadId)
  if (!row) return json({ error: 'not_found' }, 404)
  // 削除済みのスレには何も付けない（一覧にも詳細にも出ていないものを運営が触らない）。
  if (row.deleted_at !== 0) return json({ error: 'not_found' }, 404)

  const actor = actorOf(userId, await readProfile(db, userId))
  const thread = threadLikeOf(row)

  // ステータス系は種別が request / bug のときだけ（canSetStatus が種別まで見る）。
  // ピン・ロックはどの種別にも付くので canModerate で足りる。どちらも staff だけ（§5）。
  const touchesStatus =
    patch.status !== undefined ||
    patch.statusNote !== undefined ||
    patch.shippedVersion !== undefined
  const allowed = touchesStatus ? canSetStatus(actor, thread) : canModerate(actor)
  if (!allowed.ok) return denied(allowed)

  if (!(await checkRateLimit(db, `board:${userId}`, now, BOARD_LIMITS.postsPerHour))) {
    return json({ error: 'rate_limited' }, 429)
  }

  await patchThread(db, threadId, patch, now)

  // 運営操作は頻度が低いので、更新後の姿を読み直して返す（画面が推測で描かなくて済む）。
  const after = await readThreadDetail(db, threadId, userId)
  if (!after) return json({ error: 'not_found' }, 404)
  return json({ thread: toThread(after.thread, userId) })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const threadId = threadIdOf(context.request)
  if (!threadId) return json({ error: 'missing_id' }, 400)

  const row = await readThread(db, threadId)
  if (!row) return json({ error: 'not_found' }, 404)

  const actor = actorOf(userId, await readProfile(db, userId))
  const thread = threadLikeOf(row)

  // 消せるのは自分のスレだけ。staff でも他人のスレは消さない（消すのは本人・運営は非表示）。
  const allowed = canDeleteThread(actor, thread)
  if (!allowed.ok) return denied(allowed)

  if (!(await checkRateLimit(db, `board:${userId}`, now, BOARD_LIMITS.postsPerHour))) {
    return json({ error: 'rate_limited' }, 429)
  }

  // 返信が 1 件でもあれば 'head-only'＝本文（seq=1）だけ伏せ、他人の返信は残す（§7-5）。
  const mode = threadDeleteMode(thread)
  await softDeleteThread(db, threadId, mode, now)

  return json({ ok: true, mode })
}
