/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/threads — スレッドの一覧とスレ立て（設計 docs/requirement/09-board.md §5）。
 *   GET  = 一覧（`?kind=` / `?cursor=`）。**未ログインでも 200**（§2）。
 *          ログインしていれば各行の `mine` / `liked` が埋まる。
 *   POST = スレ立て。**本文は board_posts の seq=1 として入れる**（§4）＝本文と返信で
 *          削除・通報・非表示の経路が 1 本に揃う。任意でアンケートを 1 つ添えられる。
 *
 * ここで SQL は書かない。掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約し、
 * 「削除・非表示を除く条件」の書き忘れから本文が漏れる経路（§7-6）を作らない。
 *
 * POST の判定順は **認証 → 入力 → 表示名 → 投稿禁止 → スレ 3 本/日 → レート制限 → 書き込み**。
 * 先に安い判定（ネットワークも DB も要らないもの）を済ませ、DB を叩く判定を後ろに置く。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（同じリクエストの中で時刻がずれない・
 * テストから固定できる）。
 */

import { urlKeyOf } from '../../../src/core/board/link'
import { type Actor, isBanned } from '../../../src/core/board/permission'
import { validatePollInput } from '../../../src/core/board/poll'
import {
  BOARD_KINDS,
  BOARD_LIMITS,
  type BoardKind,
  CreateThreadInputSchema,
} from '../../../src/core/board/types'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { type BoardLinkEnv, resolveLinkCards } from '../_lib/board-link-fetch'
import {
  countThreadsSince,
  createPoll,
  createPost,
  createThread,
  linkPost,
  listThreads,
  readProfile,
  toThread,
} from '../_lib/board-store'
import { checkRateLimit } from '../_lib/rate-limit'

/** `BoardLinkEnv` が `DB` と OGP 取得の設定（PLATFORM_ORIGIN ほか）を持つ。 */
interface Env extends ClerkEnv, BoardLinkEnv {}

/** 一覧 1 ページの件数。増やすときはクライアントの読み込みも合わせる。 */
const PAGE_SIZE = 20

/** スレ 3 本/日（D-BOARD-OPEN）を数える窓。 */
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

  const viewerId = await viewerIdOf(context.request, context.env)
  const { rows, nextCursor } = await listThreads(context.env.DB, {
    kind,
    cursor: url.searchParams.get('cursor'),
    limit: PAGE_SIZE,
    viewerId,
  })

  return json({ threads: rows.map((row) => toThread(row, viewerId)), nextCursor })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  // 記名式なので書き込みはログイン必須（D-BOARD-SIGNED・§7-1）。
  // 会員判定（verifyMember）は使わない＝無料アカウントで書ける。
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const parsed = CreateThreadInputSchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'bad_request' }, 400)
  const input = parsed.data

  // 表示名が無いと投稿できない（§7-2）。画面はこの 409 を受けて設定ダイアログを出す。
  const profile = await readProfile(db, userId)
  if (!profile) return json({ error: 'profile_required' }, 409)

  const actor: Actor = {
    userId,
    role: profile.role === 'staff' ? 'staff' : 'member',
    bannedUntil: profile.banned_until,
  }
  if (isBanned(actor, now)) {
    return json({ error: 'banned', bannedUntil: profile.banned_until }, 403)
  }

  // アンケートの検証は書き込みの前（締切が過去のスレを作ってから poll だけ弾く、を避ける）。
  if (input.poll) {
    const check = validatePollInput(input.poll, now)
    if (!check.ok) return json({ error: 'bad_poll', reason: check.reason }, 400)
  }

  // スレ 3 本/日（D-BOARD-OPEN）。countThreadsSince は削除済みも数える＝
  // 消して立て直せば上限を無視できる、という抜け道を作らない。
  const threadsToday = await countThreadsSince(db, userId, now - DAY_MS)
  if (threadsToday >= BOARD_LIMITS.threadsPerDay) {
    return json({ error: 'too_many_threads' }, 429)
  }

  // 流量の安全弁（D-BOARD-RATE）。**キーは `board:` 接頭辞**＝rate_limits は user_id 1 行の
  // 表なので、素の userId を渡すと同期の 60 req/min の枠を掲示板の投稿が食う（§7-11）。
  if (!(await checkRateLimit(db, `board:${userId}`, now, BOARD_LIMITS.postsPerHour))) {
    return json({ error: 'rate_limited' }, 429)
  }

  const threadId = crypto.randomUUID()
  const postId = crypto.randomUUID()

  await createThread(db, { id: threadId, kind: input.kind, title: input.title, userId, now })
  // 本文は投稿の 1 件目（seq=1）。採番は store の INSERT ... SELECT MAX(seq)+1 に任せる。
  const { seq } = await createPost(db, {
    id: postId,
    threadId,
    userId,
    body: input.body,
    replyTo: 0,
    now,
  })

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

  return json({ id: threadId, postId, seq }, 201)
}
