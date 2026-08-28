/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/reports — 投稿の通報（設計 docs/requirement/09-board.md §5・D-BOARD-REPORT）。
 *   POST = `{ postId, reason }` を運営の作業キュー（board_reports）に 1 件積む。
 *
 * **積むだけで、何も起こさない。** 件数がいくつになっても投稿は非表示にならないし、
 * スレも持ち上がらない（D-BOARD-REPORT）。自動非表示を入れると、示し合わせた数人が
 * 正常な投稿を落とせる器になる＝通報が攻撃の道具に変わる。運営が 1 日 1 回キューを見て、
 * 非表示・投稿禁止を手で打つ（それは POST /api/board/moderate の仕事）。
 * ここに「n 件で隠す」を足したくなったら、まずこの段落を読み直すこと。
 *
 * **通報者は公開しない。** レスポンスには通報の件数も他人の通報も、自分以外の user_id も
 * 一切入れない（返すのは `{ ok: true }` だけ）。件数を返すと画面に出せてしまい、出せると
 * 「何件で消えるのか」を試す遊びが始まる。
 *
 * **同じ人が同じ投稿を何度通報しても行は増えない**（同一 post_id × user_id は 1 件）。
 * 判定を SELECT でやらず、**行 id を `sha256(postId + userId)` の決定値にして主キーの
 * UNIQUE に任せる**。読んでから書くと、連打（二重送信）で読みと書きの間に滑り込まれて
 * 2 行入る。id にハッシュを使うのは、キューの行 id から通報者を読み取れないようにするため
 *（素の `${postId}:${userId}` を id にすると、id 自体が通報者の名簿になる）。
 * 2 度目は UNIQUE 違反になるので、それを捕まえて 1 度目と同じ 200 を返す＝冪等。
 * 既存行の `created_at`・`handled_at` は上書きしない（処理済みの通報が再通報で
 * 未処理に戻らない。別の人が通報すれば、その人ぶんの行が新しく積まれる）。
 *
 * ここで SQL は書かない（掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約）。
 *
 * 判定順は **認証 → 入力 → 投稿の存在 → レート制限 → 書き込み**。安い判定から先に済ませ、
 * カウンタを進める判定を後ろに置く（弾かれるリクエストで流量の枠を食わない）。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（テストから固定できる）。
 */

import { BOARD_LIMITS, ReportInputSchema } from '../../../src/core/board/types'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { insertReport, readPost } from '../_lib/board-store'
import { sha256Hex } from '../_lib/crypto'
import { checkRateLimit } from '../_lib/rate-limit'

interface Env extends ClerkEnv {
  DB: D1Database
}

/**
 * 通報 1 件の行 id。同じ人が同じ投稿を通報したら必ず同じ値になり、主キーの UNIQUE が
 * 2 行目を弾く（アプリ側の重複チェックは競合ですり抜けるので置かない）。
 * ハッシュにして、id から通報者を逆に読めないようにする。
 */
const reportIdOf = (postId: string, userId: string): Promise<string> =>
  sha256Hex(`board-report\n${postId}\n${userId}`)

/**
 * 主キーの重複か（＝同じ人の 2 度目の通報）。D1 は
 * `D1_ERROR: UNIQUE constraint failed: board_reports.id` を投げる。
 * 文言で見分けるのは荒いが、ここで握り潰したいのは重複だけ＝それ以外の DB 障害は
 * 投げ直して 500 にする（通報が黙って消えるのがいちばん困る）。
 */
const isDuplicate = (e: unknown): boolean =>
  e instanceof Error && /UNIQUE constraint failed/i.test(e.message)

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので通報もログイン必須（D-BOARD-SIGNED・§7-1）。会員判定（verifyMember）は
  // 使わない＝無料アカウントで通報できる。匿名の通報を受けると、誰が何件出したかを
  // 追えないまま運営が判断することになる。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const parsed = ReportInputSchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'bad_request' }, 400)
  const input = parsed.data

  // 表示名（board_profiles）は要求しない。通報は記名で表に出るものではないので、
  // 投稿（§7-2 の profile_required）と同じ入口を通す必要がない。設定ダイアログを
  // 挟むと、荒らしを見つけた通りすがりが通報をやめる。
  const post = await readPost(db, input.postId)
  if (!post) return json({ error: 'not_found' }, 404)

  // 削除済み・運営が非表示にした投稿でも通報は受ける。伏せ字になっているだけで行は
  // 残っており（D-BOARD-DELETE）、投稿者への措置（投稿禁止）はまだ打てるため。

  // 投稿禁止（banned）の利用者も通報はできる。禁止しているのは書き込みであって、
  // 運営への申告まで塞ぐと、揉め事の片側だけが通報できる状態になる。だから
  // `board_profiles` は読まない（読んでも扱いを変えないので、無駄に 1 回 DB を叩かない）。

  // 流量の安全弁（D-BOARD-RATE）。**キーは `board:` 接頭辞**＝rate_limits は user_id 1 行の
  // 表なので、素の userId を渡すと同期の 60 req/min の枠を掲示板の操作が食う（§7-11）。
  // 重複した通報も枠を使う（行は増えないが、連打の相手をする理由もない）。
  if (!(await checkRateLimit(db, `board:${userId}`, now, BOARD_LIMITS.postsPerHour))) {
    return json({ error: 'rate_limited' }, 429)
  }

  try {
    await insertReport(db, {
      id: await reportIdOf(input.postId, userId),
      postId: input.postId,
      userId,
      reason: input.reason,
      now,
    })
  } catch (e) {
    if (!isDuplicate(e)) throw e
    // 2 度目以降。行は 1 件のまま、1 度目と同じ返事をする。
  }

  // 返すのはこれだけ。件数も通報者も、行 id すら返さない。
  return json({ ok: true })
}
