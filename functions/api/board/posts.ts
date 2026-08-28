/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/posts — スレへの返信と、自分の投稿の取り消し（設計 docs/requirement/09-board.md §5）。
 *   POST   = `?thread=<id>` に返信を 1 件足す。本文は board_posts の seq>=2 に積む
 *            （seq=1 はスレ本文・§4）。リンクカードの取得もここで走る。
 *   DELETE = `?id=<postId>` 自分の投稿を論理削除する。**行は消さない**（D-BOARD-DELETE）。
 *
 * 単体を `?thread=` / `?id=` のクエリで指すのは既存 `functions/api/sync/work.ts` の流儀に
 * 合わせたもの（Pages Functions のファイルルーティングに動的セグメントを増やさない）。
 *
 * ここで SQL は書かない。掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約し、
 * 「削除・非表示を除く条件」の書き忘れから本文が漏れる経路（§7-6）を作らない。
 * 同じく**誰が書ける／消せるかの判断も書かない**。`src/core/board/permission.ts` の
 * `canPost` / `canDeletePost` に寄せ、ここは返ってきた `reason` を `STATUS_OF_REASON` で
 * HTTP ステータスに写すだけにする＝スレ立て・返信・削除で判断がずれない。
 * とくに「他人の投稿は消せない」（§7-4）をここで書き直さない。同じ規則が 2 箇所にあると、
 * 片方だけ緩んだときに気づけない。
 *
 * POST の判定順は **認証 → 入力 → 表示名 → スレの存在 → 権限（投稿禁止・削除・ロック）→
 * 投稿 10 件/時 → 分あたりの安全弁 → 書き込み**。安い判定（ネットワークも DB も要らない
 * もの）から先に済ませ、DB を叩く判定を後ろに置く。**流量の上限は 2 枚ある**
 *（設計の 10 件/時＝`countPostsSince` と、連打を止める分あたりの弁＝`checkRateLimit`）。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（同じリクエストの中で時刻がずれない・
 * テストから固定できる）。
 */

import { urlKeyOf } from '../../../src/core/board/link'
import {
  type Actor,
  canDeletePost,
  canPost,
  type PermissionDenyReason,
  type PostLike,
  STATUS_OF_REASON,
  type ThreadLike,
} from '../../../src/core/board/permission'
import { CreatePostInputSchema } from '../../../src/core/board/types'
import { type ClerkEnv, verifyUserId } from '../_lib/auth'
import { type BoardLinkEnv, resolveLinkCards } from '../_lib/board-link-fetch'
import {
  linkPost,
  type PostRow,
  type ProfileRow,
  readPost,
  readProfile,
  readThread,
  softDeletePost,
  type ThreadRow,
} from '../_lib/board-store'
import {
  boardJson,
  conflictResponse,
  createPostRetrying,
  postQuotaExceeded,
  rateLimitedResponse,
} from './board-endpoint'

/** `BoardLinkEnv` が `DB` と OGP 取得の設定（PLATFORM_ORIGIN ほか）を持つ。 */
interface Env extends ClerkEnv, BoardLinkEnv {}

/**
 * D1 の行 → 権限判定が見る形（snake_case を camelCase に写すだけ）。
 * 判定に要る列だけを渡す＝ permission 側が D1 のスキーマを知らずに済む。
 */
const threadLikeOf = (row: ThreadRow): ThreadLike => ({
  userId: row.user_id,
  kind: row.kind,
  locked: row.locked,
  replyCount: row.reply_count,
  deletedAt: row.deleted_at,
  hiddenAt: row.hidden_at,
})

const postLikeOf = (row: PostRow): PostLike => ({
  userId: row.user_id,
  body: row.body,
  deletedAt: row.deleted_at,
  hiddenAt: row.hidden_at,
})

/**
 * 判断の主体。プロフィールが無い＝まだ掲示板の住人ではないので、立場は既定値に倒す
 *（投稿の可否は呼び出し側が `profile_required` で先に断る）。
 */
const actorOf = (userId: string, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/**
 * 権限の否決を HTTP に写す。ロック 409・投稿禁止 403・削除済み 404 といった対応表は
 * `STATUS_OF_REASON`（permission.ts）1 箇所にあり、ここでは引くだけ。
 * 投稿禁止のときだけ期限を添える＝画面が「いつまで書けないか」を出せる。
 */
const denied = (reason: PermissionDenyReason, actor: Actor): Response =>
  reason === 'banned'
    ? boardJson({ error: reason, bannedUntil: actor.bannedUntil }, STATUS_OF_REASON[reason])
    : boardJson({ error: reason }, STATUS_OF_REASON[reason])

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので書き込みはログイン必須（D-BOARD-SIGNED・§7-1）。
  // 会員判定（verifyMember）は使わない＝無料アカウントで書ける。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  const threadId = new URL(context.request.url).searchParams.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return boardJson({ error: 'bad_request' }, 400)
  }
  const parsed = CreatePostInputSchema.safeParse(raw)
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)
  const input = parsed.data

  // 表示名が無いと投稿できない（§7-2）。画面はこの 409 を受けて設定ダイアログを出す。
  // permission の deny 理由には無い＝「権限が足りない」ではなく「登録が済んでいない」なので、
  // スレ立て（threads.ts）と同じ形で先に断る。
  const profile = await readProfile(db, userId)
  if (!profile) return boardJson({ error: 'profile_required' }, 409)

  const thread = await readThread(db, threadId)
  if (!thread) return boardJson({ error: 'not_found' }, 404)

  // 投稿禁止（403）・削除済み／非表示のスレ（404 gone）・ロック（409）は、この 1 本で判定する。
  // ロック中でも staff だけは書ける（運営が締めの一言を残せる）— その判断も permission 側。
  const actor = actorOf(userId, profile)
  const allowed = canPost(actor, threadLikeOf(thread), now)
  if (!allowed.ok) return denied(allowed.reason, actor)

  // 投稿 10 件/時（D-BOARD-OPEN）。分窓の `checkRateLimit` に `postsPerHour` を渡すと
  // 10 件/分＝600 件/時になり、設計の 60 倍緩む。時間の窓は `countPostsSince` で数える。
  const overQuota = await postQuotaExceeded(db, userId, now)
  if (overQuota) return overQuota

  // 分あたりの安全弁（D-BOARD-RATE）。上の時間枠とは別物で、連打を止めるだけの役。
  // 鍵の `board:` 接頭辞と上限は board-endpoint.ts に 1 つだけ置いてある（§7-11）。
  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited

  const postId = crypto.randomUUID()
  // 採番（`INSERT ... SELECT MAX(seq)+1`）が同時投稿で競合したら 1 回だけ取り直す。
  // 例外のまま抜けると 500 になり、利用者からは書いた本文が消えたように見える。
  const created = await createPostRetrying(db, {
    id: postId,
    threadId,
    userId,
    body: input.body,
    replyTo: input.replyTo,
    now,
  })
  if (!created.ok) return conflictResponse()
  const { seq } = created

  // **`bumpThread` はここで呼ばない。** 一覧の並び（§2）に使う bumped_at と reply_count は
  // `createPost` が投稿の INSERT と同じ batch で更新する＝投稿と並びが必ず揃う。
  // ここでもう一度打つと、同じ行への UPDATE が 2 回走るだけ（D1 の書き込み行数が倍になる）。

  // リンクカード（D-BOARD-LINK / D-BOARD-OGPCACHE）。取得は投稿時の 1 回だけで、
  // 閲覧では外に出ない。**投稿を保存したあとに走らせ、失敗しても 201 を返す**＝
  // ここで 500 にすると、保存済みの返信を利用者が「失敗した」と思って書き直し、
  // 同じ返信が 2 つ並ぶ（巻き戻す手段はもう無い）。
  try {
    const cards = await resolveLinkCards(context.env, input.body, now)
    await linkPost(db, postId, await Promise.all(cards.map((card) => urlKeyOf(card.url))))
  } catch {
    // カードが付かないだけ。本文は保存済みなので、ここで巻き戻さない。
  }

  return boardJson({ id: postId, threadId, seq }, 201)
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  const postId = new URL(context.request.url).searchParams.get('id')
  if (!postId) return boardJson({ error: 'missing_id' }, 400)

  const post = await readPost(db, postId)
  if (!post) return boardJson({ error: 'not_found' }, 404)

  // **他人の投稿は消せない（403・§7-4）。** staff でも他人のは消さない（運営がやるのは
  // 非表示）。二重削除は `gone`（404）になる。
  const actor = actorOf(userId, await readProfile(db, userId))
  const allowed = canDeletePost(actor, postLikeOf(post))
  if (!allowed.ok) return denied(allowed.reason, actor)

  // スレ本文（seq=1）だけは、この経路で消させない。ここで消せてしまうと、
  // 「返信 0 なら丸ごと・返信ありなら本文だけ」というスレ削除の規則（§7-5）を
  // 素通りして、本文の無いスレが一覧に残る。スレの DELETE を使わせる。
  if (post.seq === 1) return boardJson({ error: 'use_thread_delete' }, 409)

  await softDeletePost(db, postId, now)
  return boardJson({ ok: true })
}
