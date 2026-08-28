/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/moderate — 運営の措置（設計 docs/requirement/09-board.md §5・§7-4）。
 *   POST = `{ action, postId?, userId?, url?, bannedUntil? }` を 1 件実行する。
 *     hide_post / unhide_post … 投稿を伏せる・戻す（`board_posts.hidden_at`）
 *     ban_user / unban_user   … 投稿禁止の期限を入れる・外す（`board_profiles.banned_until`）
 *     block_link              … リンクカードだけ潰す（`board_links.blocked_at`）
 *
 * **ここには「削除」が無い。** staff でも他人の投稿・スレは消せず、できるのは非表示だけ
 *（§7-4）。消えたのが本人の意思（`deleted_at`）か運営の判断（`hidden_at`）かを、後から
 * 取り違えられないようにするため。両者が同じ列に落ちると、開示請求や苦情への回答で
 * 「誰が消したのか」を証拠づけられなくなる。措置は必ず可逆（unhide / unban）で持つ。
 * `ModerateInputSchema`（src/core/board/types.ts）に削除系の action を足したくなったら、
 * まずこの段落を読み直すこと。
 *
 * **自分自身は ban できない。** 運営が 1 人の個人事業なので、誤操作で唯一の staff が
 * 書けなくなると、解除する手段が SQL の直接実行しか残らない（管理画面は作らない・§5）。
 * 入口で弾くほうが安い。
 *
 * 権限の判断はここに書かない。`src/core/board/permission.ts` の `canModerate` に寄せ、
 * ここは返ってきた `reason` を `STATUS_OF_REASON` で HTTP に写すだけ＝「staff だけ」という
 * 規則が判定用の 1 箇所にだけ在る状態を保つ（member は 403・未ログインは 401）。
 * 同じく SQL も書かない（掲示板の読み書きは `functions/api/_lib/board-store.ts` に集約）。
 *
 * 判定順は **認証 → 入力 → 権限 → 対象の存在 → レート制限 → 書き込み**。安い判定から
 * 先に済ませ、カウンタを進める判定を後ろに置く（弾かれるリクエストで流量の枠を食わない）。
 *
 * `Date.now()` は入口で 1 回だけ読み、以降は引数で回す（テストから固定できる）。
 */

import { normalizeUrl, urlKeyOf } from '../../../src/core/board/link'
import {
  type Actor,
  canModerate,
  type PermissionDenyReason,
  STATUS_OF_REASON,
} from '../../../src/core/board/permission'
import { type ModerateInput, ModerateInputSchema } from '../../../src/core/board/types'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import {
  blockLink,
  type ProfileRow,
  readLinks,
  readPost,
  readProfile,
  setBan,
  setPostHidden,
} from '../_lib/board-store'
import { checkRateLimit } from '../_lib/rate-limit'

interface Env extends ClerkEnv {
  DB: D1Database
}

/**
 * 措置の流量（分あたり）。投稿の 10 件/時ではなく `checkRateLimit` の既定と同じ 60 に置く。
 * 荒らしが一晩で撒いた 30 件を朝に片付ける、が運営の実際の使い方で、投稿と同じ枠に
 * 押し込めると「消して回れない」ほうの事故になる。安全弁としては 60/分で足りる。
 */
const MODERATE_PER_MINUTE = 60

/** D1 の行 → 権限判定が見る形。判定に要る列だけ渡す（permission 側は D1 を知らない）。 */
const actorOf = (userId: string, profile: ProfileRow | null): Actor => ({
  userId,
  role: profile?.role === 'staff' ? 'staff' : 'member',
  bannedUntil: profile?.banned_until ?? 0,
})

/** 権限の否決を HTTP に写す。対応表は permission.ts 1 箇所にあり、ここでは引くだけ。 */
const denied = (reason: PermissionDenyReason): Response =>
  json({ error: reason }, STATUS_OF_REASON[reason])

/**
 * 投稿の非表示・解除。**行は消さず `hidden_at` を出し入れするだけ**なので、
 * 本文も `deleted_at` もそのまま残る（誤って伏せても戻せる）。
 * 返信数の数え直しは store の `setPostHidden` の中で同じ batch にまとまっている。
 */
async function moderatePost(db: D1Database, input: ModerateInput, now: number): Promise<Response> {
  const postId = input.postId?.trim()
  if (!postId) return json({ error: 'missing_post' }, 400)

  const post = await readPost(db, postId)
  if (!post) return json({ error: 'not_found' }, 404)

  const hide = input.action === 'hide_post'
  await setPostHidden(db, postId, hide ? now : 0)
  return json({ ok: true, action: input.action, postId, hidden: hide })
}

/**
 * 投稿禁止の期限を入れる・外す。
 * `board_profiles` の行が無い相手は 404 ＝**投稿できない人を先回りで禁止にはできない**
 *（記名式で表示名が要る以上、書き込んだ人には必ず行がある）。存在しない user_id への
 * ban を黙って受けると、打ったつもりの措置が効いていないことに気づけない。
 * 期限は未来でなければ意味がない（過ぎた時刻＝即座に明ける）ので入口で弾く。
 */
async function moderateUser(db: D1Database, input: ModerateInput, now: number): Promise<Response> {
  const targetId = input.userId?.trim()
  if (!targetId) return json({ error: 'missing_user' }, 400)

  const ban = input.action === 'ban_user'
  const bannedUntil = ban ? (input.bannedUntil ?? 0) : 0
  if (ban && !(Number.isFinite(bannedUntil) && bannedUntil > now)) {
    return json({ error: 'bad_banned_until' }, 400)
  }

  const target = await readProfile(db, targetId)
  if (!target) return json({ error: 'not_found' }, 404)

  await setBan(db, targetId, bannedUntil, now)
  return json({ ok: true, action: input.action, userId: targetId, bannedUntil })
}

/**
 * リンクカードを URL 単位で潰す（設計 §3.2）。**投稿は残したまま**カードだけ消える。
 * キーは `board_links` と同じ「正規化 URL の SHA-256 先頭 32 桁」で作る＝運営が本文から
 * コピーした URL に `?utm_source=` や末尾スラッシュが付いていても同じ行に当たる
 *（正規化を挟まないと、貼られたのと 1 文字違う URL を潰して効いたつもりになる）。
 * キャッシュに無い URL は 404。まだ誰も貼っていない URL を先回りで潰す器ではない
 *（`blockLink` は UPDATE なので行が無ければ何も起きず、成功を返すと嘘になる）。
 */
async function moderateLink(db: D1Database, input: ModerateInput, now: number): Promise<Response> {
  const raw = input.url?.trim()
  if (!raw) return json({ error: 'missing_url' }, 400)

  const normalized = normalizeUrl(raw)
  if (!normalized) return json({ error: 'bad_url' }, 400)

  const urlKey = await urlKeyOf(normalized)
  const [link] = await readLinks(db, [urlKey])
  if (!link) return json({ error: 'not_found' }, 404)

  await blockLink(db, urlKey, now)
  return json({ ok: true, action: input.action, urlKey, url: link.url })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = Date.now()
  const db = context.env.DB

  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  // 未知の action（`delete_post` など）はここで 400 になる。**運営に削除の経路は無い**
  // という規則が、スキーマ 1 箇所で守られている状態を保つ（§7-4）。
  const parsed = ModerateInputSchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'bad_request' }, 400)
  const input = parsed.data

  // staff だけ（§7-4）。member は 403、未ログインは上で 401。
  const actor = actorOf(userId, await readProfile(db, userId))
  const allowed = canModerate(actor)
  if (!allowed.ok) return denied(allowed.reason)

  // 誤操作で唯一の staff が自分を締め出すのを防ぐ（解除に SQL の直接実行が要る）。
  if (input.action === 'ban_user' && input.userId?.trim() === userId) {
    return json({ error: 'cannot_ban_self' }, 400)
  }

  // 流量の安全弁（D-BOARD-RATE）。**キーは `board:` 接頭辞**＝rate_limits は user_id 1 行の
  // 表なので、素の userId を渡すと同期の 60 req/min の枠を掲示板の操作が食う（§7-11）。
  if (!(await checkRateLimit(db, `board:${userId}`, now, MODERATE_PER_MINUTE))) {
    return json({ error: 'rate_limited' }, 429)
  }

  switch (input.action) {
    case 'hide_post':
    case 'unhide_post':
      return await moderatePost(db, input, now)
    case 'ban_user':
    case 'unban_user':
      return await moderateUser(db, input, now)
    case 'block_link':
      return await moderateLink(db, input, now)
  }
}
