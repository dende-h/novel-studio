/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/threads — スレッドの一覧とスレ立て（設計 docs/requirement/09-board.md §5）。
 *   GET  = 一覧（`?kind=` / `?cursor=`）。**未ログインでも 200**（§2）。
 *          ログインしていれば各行の `mine` / `liked` が埋まる。
 *          `?kind=` が拾う種別は `kindsForFilter`（要望のタブには旧「目安箱」も並ぶ）。
 *   POST = スレ立て。**本文は board_posts の seq=1 として入れる**（§4）＝本文と返信で
 *          削除・通報・非表示の経路が 1 本に揃う。任意でアンケートを 1 つ添えられる。
 *
 * ここで SQL は書かない。掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約し、
 * 「削除・非表示を除く条件」の書き忘れから本文が漏れる経路（§7-6）を作らない。
 *
 * POST の判定順は **認証 → 入力 → 表示名 → 投稿禁止・種別（`canCreateThread`）→
 * スレ 10 本/日（staff は除外）→ 投稿 10 件/時 → 分あたりの安全弁 → 書き込み**。
 * 先に安い判定（ネットワークも DB も要らないもの）を済ませ、
 * DB を叩く判定を後ろに置く。**流量の上限は 2 枚ある**（設計の 10 件/時と、連打を止める
 * 分あたりの弁）。前者を分窓の `checkRateLimit` に任せると 10 件/分＝60 倍緩くなる。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（同じリクエストの中で時刻がずれない・
 * テストから固定できる）。
 */

import { urlKeyOf } from '../../../src/core/board/link'
import { type Actor, canCreateThread, STATUS_OF_REASON } from '../../../src/core/board/permission'
import { validatePollInput } from '../../../src/core/board/poll'
import {
  BOARD_KINDS,
  BOARD_LIMITS,
  type BoardKind,
  CreateThreadInputSchema,
  kindsForFilter,
} from '../../../src/core/board/types'
import { type ClerkEnv, verifyUserId } from '../_lib/auth'
import { type BoardLinkEnv, resolveLinkCards } from '../_lib/board-link-fetch'
import {
  countThreadsSince,
  createPoll,
  createThread,
  linkPost,
  listThreads,
  readProfile,
  softDeleteThread,
  toThread,
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

/** 一覧 1 ページの件数。増やすときはクライアントの読み込みも合わせる。 */
const PAGE_SIZE = 20

/** スレ 10 本/日（D-BOARD-OPEN）を数える窓。 */
const DAY_MS = 24 * 60 * 60 * 1000

const isBoardKind = (v: string | null): v is BoardKind =>
  !!v && (BOARD_KINDS as readonly string[]).includes(v)

/**
 * 閲覧者の userId（未ログインは null）。
 * **認証の失敗で一覧を落とさない**＝読むのは誰でもできる（§2）。壊れた・期限切れの
 * セッションを持ったまま覗きに来た読者に 500 を返すと、掲示板が真っ白になる。
 */
async function viewerIdOf(request: Request, env: Env): Promise<string | null> {
  try {
    return await verifyUserId(request, env)
  } catch {
    return null
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const kindParam = url.searchParams.get('kind')
  // 知らない種別は「絞り込みなし」に倒す（400 で一覧ごと落とさない）。
  // 壊れたカーソルを無視する board-store と同じ方針で、URL を手で触っただけの利用者に
  // エラー画面を見せない。
  const kind = isBoardKind(kindParam) ? kindParam : null

  // タブ 1 つが拾う種別（`kindsForFilter`）。「要望」は**旧 `suggestion` のスレも一緒に**出す。
  // 統合した以上、片方だけタブから漏れると利用者には「目安箱に書いたスレが消えた」に見える。
  // `?kind=suggestion` の古いブックマークも同じ集合に寄る。
  const wanted = kind ? kindsForFilter(kind) : null

  // **絞り込みは必ず SQL 側で行う。** 引いた 20 件を JS で捨てる作りにすると、
  // ほかの種別が多いときに「1 ページ目が空なのに nextCursor だけ返る」＝
  // 画面が『要望タブが空＋もっと読む』になる（雑談 25 件・要望 1 件で再現した）。
  const viewerId = await viewerIdOf(context.request, context.env)
  const { rows, nextCursor } = await listThreads(context.env.DB, {
    kinds: wanted,
    cursor: url.searchParams.get('cursor'),
    limit: PAGE_SIZE,
    viewerId,
  })

  return boardJson({ threads: rows.map((row) => toThread(row, viewerId)), nextCursor })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので書き込みはログイン必須（D-BOARD-SIGNED・§7-1）。
  // 会員判定（verifyMember）は使わない＝無料アカウントで書ける。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return boardJson({ error: 'bad_request' }, 400)
  }
  const parsed = CreateThreadInputSchema.safeParse(raw)
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)
  const input = parsed.data

  // 表示名が無いと投稿できない（§7-2）。画面はこの 409 を受けて設定ダイアログを出す。
  const profile = await readProfile(db, userId)
  if (!profile) return boardJson({ error: 'profile_required' }, 409)

  const actor: Actor = {
    userId,
    role: profile.role === 'staff' ? 'staff' : 'member',
    bannedUntil: profile.banned_until,
  }
  // スレを立てられるか（判定は permission.ts の `canCreateThread` 1 本だけを引く。
  // 種別の表をここに書き写すと、契約が増えたときに片方だけ古くなる）。
  // ここで落ちるのは 3 つ。投稿禁止中（403）／廃止した `suggestion` での新規作成
  //（400 unsupported-kind。画面の選択肢には出ないが、API を直に叩けば届く）／
  // member による `notice`（お知らせ）のスレ立て（403 forbidden）。
  // **返信はこの判定を通らない**（`canPost`）＝お知らせにも旧目安箱のスレにも誰でも書ける。
  const allowed = canCreateThread(actor, input.kind, now)
  if (!allowed.ok) {
    // 投稿禁止のときだけ期限を添える（画面が「いつまで書けないか」を出せる）。
    // それ以外は理由 → ステータスの対応表をそのまま写す。
    if (allowed.reason === 'banned') {
      return boardJson(
        { error: 'banned', bannedUntil: profile.banned_until },
        STATUS_OF_REASON.banned,
      )
    }
    return boardJson({ error: allowed.reason }, STATUS_OF_REASON[allowed.reason])
  }

  // アンケートの検証は書き込みの前（締切が過去のスレを作ってから poll だけ弾く、を避ける）。
  if (input.poll) {
    const check = validatePollInput(input.poll, now)
    if (!check.ok) return boardJson({ error: 'bad_poll', reason: check.reason }, 400)
  }

  // スレ 10 本/日（D-BOARD-OPEN）。countThreadsSince は削除済みも数える＝
  // 消して立て直せば上限を無視できる、という抜け道を作らない。
  //
  // **運営（staff）は数えない。** この上限が守るのは「一人が一覧を埋めない」ことで、
  // 呼び水スレやお知らせを並べる運営はその心配の相手ではない。除外しないと、
  // 掲示板を立ち上げる当人が最初に引っかかる（実際に引っかかった）。
  if (actor.role !== 'staff') {
    const threadsToday = await countThreadsSince(db, userId, now - DAY_MS)
    if (threadsToday >= BOARD_LIMITS.threadsPerDay) {
      return boardJson({ error: 'too_many_threads' }, 429)
    }
  }

  // 投稿 10 件/時（D-BOARD-OPEN）。**スレ本文も board_posts の 1 件**なので、スレ立ても
  // 返信と同じ枠を食う（種類ごとに枠を分けると「スレなら書ける」抜け道ができる）。
  const overQuota = await postQuotaExceeded(db, userId, now)
  if (overQuota) return overQuota

  // 分あたりの安全弁（D-BOARD-RATE）。上の時間枠とは別物で、連打を止めるだけの役。
  // 鍵の `board:` 接頭辞と上限は board-endpoint.ts に 1 つだけ置いてある（§7-11）。
  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited

  const threadId = crypto.randomUUID()
  const postId = crypto.randomUUID()

  await createThread(db, { id: threadId, kind: input.kind, title: input.title, userId, now })
  // 本文は投稿の 1 件目（seq=1）。採番は store の INSERT ... SELECT MAX(seq)+1 に任せる。
  // 採番が競合したときは 1 回だけ取り直す（例外のまま 500 にすると、書いた本文が
  // どこにも残らずスレ行だけが生まれる）。
  const created = await createPostRetrying(db, {
    id: postId,
    threadId,
    userId,
    body: input.body,
    replyTo: 0,
    now,
  })
  if (!created.ok) {
    // 本文の入らないスレ行だけが一覧に残るのを防ぐ（見出しだけあって中身が無いスレは、
    // 立てた本人にも消せない）。利用者には 409 を返して、そのまま送り直してもらう。
    await softDeleteThread(db, threadId, 'whole', now, userId)
    return conflictResponse()
  }
  const { seq } = created

  if (input.poll) {
    await createPoll(db, {
      threadId,
      question: input.poll.question,
      options: input.poll.options,
      multiple: input.poll.multiple,
      closesAt: input.poll.closesAt,
      now,
    })
  }

  // リンクカード（D-BOARD-LINK / D-BOARD-OGPCACHE）。取得は投稿時の 1 回だけで、
  // 閲覧では外に出ない。**投稿を保存したあとに走らせ、失敗しても 201 を返す**＝
  // ここで 500 にすると、保存済みのスレを利用者が「失敗した」と思って立て直し、
  // 同じスレが 2 本並ぶ（巻き戻す手段はもう無い）。
  try {
    const cards = await resolveLinkCards(context.env, input.body, now)
    await linkPost(db, postId, await Promise.all(cards.map((card) => urlKeyOf(card.url))))
  } catch {
    // カードが付かないだけ。本文は保存済みなので、ここで巻き戻さない。
  }

  return boardJson({ id: threadId, postId, seq }, 201)
}
