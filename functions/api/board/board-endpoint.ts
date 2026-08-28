/// <reference types="@cloudflare/workers-types" />
/**
 * 掲示板エンドポイントの共通部品（流量・レスポンスの見出し・書き込みの競合）。
 *
 * ここに集めたのは「8 本のハンドラが同じ規則で守らなければ意味がないもの」だけ。
 * 各ファイルに書き写すと、片方だけ緩んだときに誰も気づけない（実際、投稿 10 件/時が
 * 全ハンドラで分窓の 10 件/分として効いていた）。SQL も権限判定もここには置かない
 *（前者は `functions/api/_lib/board-store.ts`、後者は `src/core/board/permission.ts`）。
 *
 * 設計書: docs/requirement/09-board.md（D-BOARD-OPEN / D-BOARD-RATE）
 */

import { BOARD_LIMITS } from '../../../src/core/board/types'
import { json } from '../_lib/auth'
import { countPostsSince, createPost } from '../_lib/board-store'
import { checkRateLimit } from '../_lib/rate-limit'

/** 投稿 10 件/時（D-BOARD-OPEN）を数える窓。 */
export const HOUR_MS = 60 * 60 * 1000

/**
 * 掲示板の操作すべてに掛かる**分あたりの安全弁**。連打・自動化を止めるためだけの数字で、
 * 設計の上限（投稿 10 件/時・スレ 3 本/日）とは別枠にする。
 *
 * `checkRateLimit`（`functions/api/_lib/rate-limit.ts`）の窓は 60 秒なので、ここへ
 * `BOARD_LIMITS.postsPerHour`（＝10）を渡すと「10 件/分＝600 件/時」になり、設計の 60 倍
 * 緩くなる。時間あたりの上限は `postQuotaExceeded`（`countPostsSince`）が数える。
 *
 * **操作ごとに違う値を渡さない。** `rate_limits` は `user_id` 1 行の表で、掲示板は
 * `board:${userId}` の 1 行を全操作で共有している。ここで 👍 だけ 30、返信だけ 10 と
 * 分けると、一覧で 👍 を 10 回押した利用者がその 1 分間まったく書けなくなる
 *（押しただけなのに書けない、という壊れ方をする）。値を分けたいなら鍵も分ける必要がある。
 *
 * 同期 API の既定（60 req/min）と `moderate.ts` の `MODERATE_PER_MINUTE` に合わせてある。
 * **同じ鍵を使う掲示板のハンドラは全部この値を渡すこと**（`reports.ts` はまだ
 * `BOARD_LIMITS.postsPerHour` を渡しており、他の操作で 10 を超えた分窓では通報が 429 になる）。
 *
 * TODO: 掲示板の閾値は本来 `src/core/board/types.ts` の `BOARD_LIMITS` に置き、
 * サーバと画面が同じ値を見る（`postsPerMinute` として移す）。types.ts が別担当のため暫定でここに置く。
 */
export const BOARD_ACTIONS_PER_MINUTE = 60

/** 掲示板のレート制限の鍵。**`board:` 接頭辞**で同期 API の 60 req/min と枠を分ける（§7-11）。 */
export const boardRateKey = (userId: string): string => `board:${userId}`

/**
 * 掲示板のレスポンス。**`private, no-store` を必ず付ける**（`_lib/auth.ts` の `json` は
 * 同期 API と共有なのでここで足す）。`mine` / `liked` / `canPost` は閲覧者ごとに違うので、
 * 将来 CDN や `public/_headers` でキャッシュを足したときに他人の状態が配られてはいけない。
 */
export function boardJson(data: unknown, status = 200): Response {
  const res = json(data, status)
  res.headers.set('cache-control', 'private, no-store')
  return res
}

/**
 * 分あたりの安全弁。超えていたら 429 のレスポンスを、通れば null を返す
 *（`if (res) return res` の 1 行で使える形＝呼び忘れが読んで分かる）。
 * カウンタを進めるので、**弾かれる判定より後ろ・書き込みの直前**で呼ぶ。
 */
export async function rateLimitedResponse(
  db: D1Database,
  userId: string,
  now: number,
): Promise<Response | null> {
  const ok = await checkRateLimit(db, boardRateKey(userId), now, BOARD_ACTIONS_PER_MINUTE)
  return ok ? null : boardJson({ error: 'rate_limited' }, 429)
}

/**
 * 投稿 10 件/時（D-BOARD-OPEN）。**投稿を作る経路（スレ立て・返信）だけ**で呼ぶ。
 * スレ本文は `board_posts` の seq=1 なので、スレ立ても 1 件として数に入る。
 *
 * `countPostsSince` は削除済みも数える＝消して書き直せば上限を無視できる抜け道を作らない。
 * 判定と INSERT の間は原子的ではないので、同時送信で 11 件目が通ることはありうる。
 * 厳密さより「一晩で数千件」を止めることが目的なので、分あたりの安全弁と 2 枚で受ける。
 */
export async function postQuotaExceeded(
  db: D1Database,
  userId: string,
  now: number,
): Promise<Response | null> {
  const posted = await countPostsSince(db, userId, now - HOUR_MS)
  if (posted < BOARD_LIMITS.postsPerHour) return null
  // スレ 3 本/日 の `too_many_threads` と揃える（画面は error だけで文面を出し分ける）。
  return boardJson({ error: 'too_many_posts' }, 429)
}

/** UNIQUE 制約違反か。D1 は `UNIQUE constraint failed: ...` を含むメッセージで投げる。 */
const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Error && /UNIQUE constraint failed/i.test(err.message)

/**
 * 投稿を 1 件足す。**seq の競合（UNIQUE(thread_id, seq)）だけは 1 回だけ再試行する。**
 *
 * `createPost` の採番は `INSERT ... SELECT MAX(seq)+1` で、同時に 2 人が同じスレへ書くと
 * 2 本目が UNIQUE で落ちる。そのまま例外を投げると Pages が 500 を返し、利用者から見ると
 * **書いた本文が消える**（201 も 409 も返らないので、再送していいのかも分からない）。
 * 採番は「今の最大値 + 1」なので、やり直せばほぼ通る。それでも駄目なら 409 を返し、
 * 画面に「もう一度送ってください」と出させる。
 *
 * UNIQUE 以外の失敗は握り潰さない（DB が壊れているのを 409 に見せかけない）。
 */
export async function createPostRetrying(
  db: D1Database,
  input: Parameters<typeof createPost>[1],
): Promise<{ ok: true; seq: number } | { ok: false }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ok: true, seq: (await createPost(db, input)).seq }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  }
  return { ok: false }
}

/** 書き込みが競合して諦めたときの応答（再送で直るので、恒久的な失敗と区別する）。 */
export const conflictResponse = (): Response => boardJson({ error: 'conflict' }, 409)
