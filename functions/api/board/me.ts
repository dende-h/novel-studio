/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/me — 自分の掲示板プロフィールと、自分の書き込み（設計 docs/requirement/09-board.md §5）。
 *   GET = 表示名・立場（staff か）・投稿禁止の期限 ＋ 直近の自分の投稿。
 *   PUT = 表示名の設定・変更（初回登録も改名も同じ入口）。
 *
 * 掲示板は記名式（D-BOARD-SIGNED）で、**表示名がそのまま信用の単位**になる。だから
 * 「見た目が同じで中身が違う名前」を 2 つ作れてはいけない。その判断は
 * `src/core/board/name.ts` の `validateDisplayName` 1 本に閉じてあり、ここでは
 * 返ってきた `reason` を HTTP に写すだけにする（§7-3）。規則をこちらに書き写すと、
 * 画面と片方だけ緩んだときに気づけない。
 *
 * **重複は 2 段で止める。** アプリ側の事前 SELECT（`upsertProfile` の中）と、D1 の
 * `UNIQUE(name_key)`。同時に同じ名前を登録されると事前 SELECT はすり抜けるので、
 * 制約違反の例外も store が `duplicate` に畳んで返す。ここは 2 つを同じ 409 にする。
 *
 * ここで SQL は書かない（掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約）。
 *
 * 未ログインは GET も PUT も 401。読み取りが 200 なのはスレの一覧・詳細だけで（§7-1）、
 * 「自分の」プロフィールと書き込みは自分にしか意味がない。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（テストから固定できる）。
 */

import { validateDisplayName } from '../../../src/core/board/name'
import {
  type Actor,
  DELETED_BODY_TEXT,
  HIDDEN_BODY_TEXT,
  isBanned,
} from '../../../src/core/board/permission'
import { boardBodyToPlain } from '../../../src/core/board/render'
import {
  BOARD_LIMITS,
  type BoardKind,
  type BoardMeResponse,
  type MyBoardPost,
  ProfileInputSchema,
} from '../../../src/core/board/types'
import { type ClerkEnv, verifyUserId } from '../_lib/auth'
import {
  listPostsByUser,
  type MyPostRow,
  type ProfileRow,
  readProfile,
  toProfile,
  upsertProfile,
} from '../_lib/board-store'
import { boardJson, rateLimitedResponse } from './board-endpoint'

interface Env extends ClerkEnv {
  DB: D1Database
}

/**
 * 「自分の書き込み」タブに返す件数。未読バッジ（最後に見た時刻との比較・設計 §2）は
 * クライアント側で数えるので、そのぶんが載る程度あればよい。
 */
const MY_POSTS_LIMIT = 50

/**
 * 返す形（`MyBoardPost` / `BoardMeResponse`）は **`src/core/board/types.ts` の契約をそのまま
 * 使う**。ここに interface を置き直すと、画面（`src/ui/_api/board.ts`）は `functions/` を
 * import できない（workers-types が src に混ざる）ぶん同じ形を手で書き写すことになり、
 * 片方だけ変わっても誰も気づかない。**本文は抜粋だけ**返すのも契約側に書いてある。
 */

/**
 * 行 → 画面が見る形。**削除・非表示の本文はここで伏字に落とす**（§7-6）。
 * `board-store.ts` の `toPost` と同じ規則だが、あちらは投稿者名を JOIN した行
 *（`PostWithAuthorRow`）を相手にする。ここは自分の投稿しか出さないので名前が要らず、
 * 代わりにスレの見出しが要る＝行の形が違うので別に写す。
 */
function toMyPost(row: MyPostRow): MyBoardPost {
  const deleted = row.deleted_at !== 0
  const hidden = row.hidden_at !== 0
  return {
    id: row.id,
    threadId: row.thread_id,
    threadTitle: row.thread_title ?? '',
    threadKind: (row.thread_kind ?? '') as BoardKind | '',
    seq: row.seq,
    excerpt: deleted ? DELETED_BODY_TEXT : hidden ? HIDDEN_BODY_TEXT : excerptOf(row.body),
    replyTo: row.reply_to,
    deleted,
    hidden,
    createdAt: row.created_at,
  }
}

/** 一覧の 1 行に収まる長さへ落とす（スレ一覧の抜粋と同じ規則・同じ上限）。 */
function excerptOf(body: string): string {
  const plain = boardBodyToPlain(body)
  const chars = [...plain]
  if (chars.length <= BOARD_LIMITS.excerpt) return plain
  return `${chars.slice(0, BOARD_LIMITS.excerpt).join('')}…`
}

/** 投稿禁止の判定に渡す主体。プロフィールが無ければ禁止もされていない。 */
const actorOf = (userId: string, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/** プロフィール ＋ 自分の投稿をまとめて返す（GET と PUT の成功時で同じ形）。 */
async function meResponse(
  db: D1Database,
  userId: string,
  now: number,
  status = 200,
): Promise<Response> {
  const [profile, posts] = await Promise.all([
    readProfile(db, userId),
    listPostsByUser(db, userId, MY_POSTS_LIMIT),
  ])
  const body: BoardMeResponse = {
    profile: profile ? toProfile(profile) : null,
    banned: isBanned(actorOf(userId, profile), now),
    posts: posts.map(toMyPost),
  }
  return boardJson(body, status)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const now = Date.now()

  // 自分のプロフィールと自分の書き込みなので、読み取りでもログインは要る。
  // 会員判定（verifyMember）は使わない＝無料アカウントで掲示板を使える（D-BOARD-SIGNED）。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  return await meResponse(context.env.DB, userId, now)
}

/**
 * 表示名の設定・変更。初回登録と改名を分けないのは、`board_profiles` の行が
 * 「あるか無いか」だけで初回かどうかが決まり、入力も検証もまったく同じだから。
 *
 * 判定順は **認証 → 入力（Zod）→ 名前の検証 → 投稿禁止 → レート制限 → 書き込み**。
 * DB もネットワークも要らない判定を先に済ませ、カウンタを進める判定を後ろに置く
 *（弾かれるリクエストで流量の枠を食わない）。
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return boardJson({ error: 'bad_request' }, 400)
  }
  const parsed = ProfileInputSchema.safeParse(raw)
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)

  // Zod は「空でない 24 文字以内の文字列」までしか見ない。正規化（NFKC・ゼロ幅文字の除去）で
  // 中身が変わるので、**保存する形を決めるのは必ずこちら**（§7-3）。
  //   empty / too_long / invalid … 直せば通る入力の不備 → 400
  //   reserved                   … 名前そのものが取れない → 409（duplicate と同じ扱い）
  const checked = validateDisplayName(parsed.data.displayName)
  if (!checked.ok) {
    return boardJson({ error: checked.reason }, checked.reason === 'reserved' ? 409 : 400)
  }

  const before = await readProfile(db, userId)

  // 投稿禁止中は改名させない。表示名は過去の投稿すべてに出る（非正規化しない・D-BOARD-NAME）ので、
  // 書き込みを止めたはずの相手に「全投稿へ同時に文字を出す欄」を残すことになる。
  const actor = actorOf(userId, before)
  if (isBanned(actor, now))
    return boardJson({ error: 'banned', bannedUntil: actor.bannedUntil }, 403)

  // 分あたりの安全弁（D-BOARD-RATE）。改名は投稿ではないので時間あたりの投稿枠は使わない
  //（改名を試した回数で返信が書けなくなる、という巻き添えを作らない）。
  // 鍵の `board:` 接頭辞と上限は board-endpoint.ts に 1 つだけ置いてある（§7-11）。
  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited

  // `name_key` は `nameKeyOf(表示名)`。`validateDisplayName` が予約語の判定に使ったものと
  // 同じ鍵をそのまま保存する（作り直すと、判定に使った鍵と保存した鍵がずれうる）。
  const result = await upsertProfile(db, {
    userId,
    displayName: checked.name,
    nameKey: checked.key,
    now,
  })
  // 事前 SELECT で見つかった重複も、UNIQUE(name_key) がすり抜けを弾いた場合も同じ 409。
  // 画面から見れば「その名前は取れなかった」で、原因の違いに意味はない。
  if (!result.ok) return boardJson({ error: result.reason }, 409)

  // 初回登録は 201（画面が「登録できました」と「変更しました」を出し分けられる）。
  return await meResponse(db, userId, now, before ? 200 : 201)
}
