/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/vote — アンケートへの投票（設計 docs/requirement/09-board.md §5 / D-BOARD-POLL）。
 *   POST = `?thread=<id>` のスレに付いたアンケートへ 1 票入れる。
 *
 * 単体を `?thread=` のクエリで指すのは既存 `functions/api/sync/work.ts`・`posts.ts` の流儀
 *（Pages Functions のファイルルーティングに動的セグメントを増やさない）。
 *
 * このファイルは**判断を持たない**。SQL は `functions/api/_lib/board-store.ts`、
 * 誰が触れるかは `src/core/board/permission.ts`、アンケートの規則は
 * `src/core/board/poll.ts` にあり、ここは結果を HTTP に写すだけにする。
 *
 * 守るべき不変条件（§7-7）:
 *   * **締切後は投票できない**（409 `closed`）。締切ちょうど（`now === closesAt`）は締切後。
 *   * **1 アカウント 1 票で、上書きしない**（2 回目は 409 `already_voted`）。
 *     上書きを許すと、票数が見えたあとに票を動かせてしまう。
 *     判定は `canVote` の事前チェックだけに頼らず、書き込みの `ON CONFLICT DO NOTHING`
 *     の行数でも確かめる＝同じ人が同時に 2 回押しても片方しか通らない。
 *   * 成功したら `pollResultFor` の結果（票数入り）をそのまま返す。**投票した瞬間から
 *     結果が見える**ので、画面は投票後にもう一度スレを読み直さなくてよい。
 *     開示してよいかの判断は `pollResultFor` の中にしかない（0 埋めもしない）。
 *
 * 判定順は **認証 → 入力 → 表示名 → スレ → 権限 → アンケート → 投票可否 → 選択肢 →
 * レート制限 → 書き込み**。安い判定から先に済ませ、レート制限の消費は
 * 「本当に書きに行く直前」まで遅らせる＝締切後や 2 回目の空振りで枠を食わない。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（同じリクエストの中で締切判定と
 * 保存時刻がずれない・テストから固定できる）。
 */

import {
  type Actor,
  canPost,
  type PermissionDenyReason,
  STATUS_OF_REASON,
  type ThreadLike,
} from '../../../src/core/board/permission'
import { canVote, normalizeChoices, pollResultFor } from '../../../src/core/board/poll'
import { VoteInputSchema } from '../../../src/core/board/types'
import { type ClerkEnv, verifyUserId } from '../_lib/auth'
import {
  insertVote,
  listVotes,
  type ProfileRow,
  readPoll,
  readProfile,
  readThread,
  readVote,
  type ThreadRow,
  toPoll,
  toVote,
} from '../_lib/board-store'
import { boardJson, rateLimitedResponse } from './board-endpoint'

interface Env extends ClerkEnv {
  DB: D1Database
}

/** D1 の行 → 権限判定が見る形（判定に要る列だけ渡す）。 */
const threadLikeOf = (row: ThreadRow): ThreadLike => ({
  userId: row.user_id,
  kind: row.kind,
  locked: row.locked,
  replyCount: row.reply_count,
  deletedAt: row.deleted_at,
  hiddenAt: row.hidden_at,
})

/** 判断の主体。プロフィールが無いときは既定値に倒す（`profile_required` で先に断る）。 */
const actorOf = (userId: string, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/** 権限の否決を HTTP に写す（対応表は permission.ts の 1 箇所にある）。 */
const denied = (reason: PermissionDenyReason, actor: Actor): Response =>
  reason === 'banned'
    ? boardJson({ error: reason, bannedUntil: actor.bannedUntil }, STATUS_OF_REASON[reason])
    : boardJson({ error: reason }, STATUS_OF_REASON[reason])

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので投票もログイン必須（D-BOARD-SIGNED・§7-1）。
  // 会員判定（verifyMember）は使わない＝無料アカウントで投票できる。
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
  const parsed = VoteInputSchema.safeParse(raw)
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)

  // 表示名が無いと投票できない（§7-2）。誰が投じたかを記名で持つ以上、投稿と条件を揃える。
  // 画面はこの 409 を受けて表示名の設定ダイアログを出す。
  const profile = await readProfile(db, userId)
  if (!profile) return boardJson({ error: 'profile_required' }, 409)

  const thread = await readThread(db, threadId)
  if (!thread) return boardJson({ error: 'not_found' }, 404)

  // 投稿禁止（403）・削除済み／非表示のスレ（404）・ロック（409）は `canPost` で判定する。
  // 投票も「そのスレへの書き込み」なので、返信と同じ 1 本の判断に乗せる
  //（ここで独自に書き直すと、片方だけ緩んだときに気づけない）。
  const actor = actorOf(userId, profile)
  const allowed = canPost(actor, threadLikeOf(thread), now)
  if (!allowed.ok) return denied(allowed.reason, actor)

  const pollRow = await readPoll(db, threadId)
  if (!pollRow) return boardJson({ error: 'no_poll' }, 404)
  const poll = toPoll(pollRow)

  // 締切後（409 `closed`）・投票済み（409 `already_voted`）。理由は poll.ts が決める。
  const myVoteRow = await readVote(db, threadId, userId)
  const votable = canVote(poll, myVoteRow ? toVote(myVoteRow) : null, now)
  if (!votable.ok) return boardJson({ error: votable.reason }, 409)

  // 範囲外・重複・単一選択なのに複数、を弾いて昇順に正規化する。
  const choices = normalizeChoices(parsed.data.choices, poll)
  if (!choices.ok) return boardJson({ error: 'bad_choices', reason: choices.reason }, 400)

  // 分あたりの安全弁（D-BOARD-RATE）。1 票は 1 回しか入らない（下の `insertVote`）ので、
  // 投稿の時間枠（10 件/時）は使わない＝票を入れても返信の枠が減らない。
  // 鍵の `board:` 接頭辞と上限は board-endpoint.ts に 1 つだけ置いてある（§7-11）。
  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited

  // 1 アカウント 1 票の最終判定。`ON CONFLICT DO NOTHING` で 0 行なら、上の canVote を
  // 通り抜けた同時押しの 2 本目＝既に票がある（上書きしない）。
  const written = await insertVote(db, { threadId, userId, choices: choices.choices, now })
  if (!written.ok) return boardJson({ error: 'already_voted' }, 409)

  // 投票直後の結果。自分の票を含めて数え直すので、画面は読み直さずに票数を出せる。
  const votes = await listVotes(db, threadId)
  return boardJson({
    poll: pollResultFor(poll, votes.map(toVote), { choices: choices.choices }, now),
  })
}
