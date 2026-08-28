/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/like — 👍 のトグル（設計 docs/requirement/09-board.md §5）。
 *   POST = `?thread=<id>` のスレに 👍 を付ける／外す。押した結果を `{ liked, likeCount }` で返す。
 *
 * 単体を `?thread=` のクエリで指すのは既存 `functions/api/sync/work.ts` と
 * `functions/api/board/posts.ts` の流儀に合わせたもの（Pages Functions のファイル
 * ルーティングに動的セグメントを増やさない）。
 *
 * **付ける／外すの判断はしない。** クライアントから「どちらにするか」を受け取らず、
 * サーバが `board_likes` の現在の有無を見て反転する（`toggleLike`）。押した側の状態を
 * 信じると、二重送信や画面のずれで「押していないのに付く」が起きるうえ、行の有無と
 * カウントの整合をサーバ側で保てない。数え直しも同じ batch の中で行われる。
 *
 * ここで SQL は書かない（掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約）。
 * 同じく**誰が押せるかの判断も書かない**。`src/core/board/permission.ts` の `canLike` に
 * 寄せ、ここは返ってきた `reason` を `STATUS_OF_REASON` で HTTP ステータスに写すだけ＝
 * 「👍 が付くのは request / bug だけ」（D-BOARD-KIND / D-BOARD-STATUS）という規則が
 * 判定用の 1 箇所にだけ在る状態を保つ。規則を写し取ると、片方だけ緩んだときに気づけない。
 *
 * 判定順は **認証 → スレの存在 → 権限（投稿禁止・種別・削除／非表示・ロック）→
 * レート制限 → 書き込み**。
 * 安い判定から先に済ませ、カウンタを進める判定を後ろに置く（弾かれるリクエストで
 * 流量の枠を食わない）。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（テストから固定できる）。
 */

import {
  type Actor,
  canLike,
  type PermissionDenyReason,
  STATUS_OF_REASON,
  type ThreadLike,
} from '../../../src/core/board/permission'
import { type ClerkEnv, verifyUserId } from '../_lib/auth'
import {
  type ProfileRow,
  readProfile,
  readThread,
  type ThreadRow,
  toggleLike,
} from '../_lib/board-store'
import { boardJson, rateLimitedResponse } from './board-endpoint'

interface Env extends ClerkEnv {
  DB: D1Database
}

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

/**
 * 判断の主体。`canLike` は投稿禁止（`bannedUntil`）まで見るので、**プロフィールから
 * 実際の値を組む**。既定値ででっち上げると、書き込みを止めた相手が 👍 だけ押せてしまう。
 */
const actorOf = (userId: string, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/**
 * 権限の否決を HTTP に写す。理由 → ステータスの対応表は `STATUS_OF_REASON`
 *（permission.ts）1 箇所にあり、ここでは引くだけ。
 * 投稿禁止のときだけ期限を添える＝画面が「いつまで書けないか」を出せる。
 */
const denied = (reason: PermissionDenyReason, actor: Actor): Response =>
  reason === 'banned'
    ? boardJson({ error: reason, bannedUntil: actor.bannedUntil }, STATUS_OF_REASON[reason])
    : boardJson({ error: reason }, STATUS_OF_REASON[reason])

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので 👍 もログイン必須（D-BOARD-SIGNED・§7-1）。
  // 会員判定（verifyMember）は使わない＝無料アカウントで押せる。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  const threadId = new URL(context.request.url).searchParams.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)

  const thread = await readThread(db, threadId)
  if (!thread) return boardJson({ error: 'not_found' }, 404)

  // 投稿禁止中は 403、ロック中は 409、種別が request / bug 以外は `unsupported-kind`、
  // 削除済み・非表示のスレは `gone`（404）。判定順は `canPost` と揃えてある（permission.ts）。
  // 表示名（board_profiles）は要求しない — 👍 は記名で表に出るものではないので、
  // 投稿（§7-2 の profile_required）と同じ入口を通す必要がない。
  // 投稿禁止の判定に `now` が要るので、入口で読んだ時刻をそのまま渡す。
  const actor = actorOf(userId, await readProfile(db, userId))
  const allowed = canLike(actor, threadLikeOf(thread), now)
  if (!allowed.ok) return denied(allowed.reason, actor)

  // 分あたりの安全弁（D-BOARD-RATE）。👍 は投稿ではないので時間あたりの投稿枠は使わない。
  // 鍵の `board:` 接頭辞と上限は board-endpoint.ts に 1 つだけ置いてある（§7-11）。
  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited

  // 付ける／外すの反転と `like_count` の数え直しは store の 1 本に閉じてある。
  const result = await toggleLike(db, threadId, userId, now)
  return boardJson(result)
}
