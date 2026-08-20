/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/hit — 訪問者数の記録（Cookie なし・自前集計）。
 *
 * public/hit.js が navigator.sendBeacon で叩く。sendBeacon の本文は text/plain 扱いなので
 * プリフライトは飛ばず、CORS ヘッダも要らない（grove など別オリジンからもそのまま届く）。
 * 応答は常に 204：計測はページの体験より優先度が低く、失敗を呼び出し側に伝える意味がない。
 *
 * 記録するのは「その日限りの不可逆な符号 1 行」だけで、IP も UA も保存しない。
 * 詳細な設計は _lib/visitor.ts と migrations/0007_visitor_days.sql を参照。
 */
import { checkRateLimit } from './_lib/rate-limit'
import {
  deviceOf,
  hostOfOrigin,
  isBot,
  jstDate,
  normalizePath,
  refererHostOf,
  siteOf,
  uaFamily,
  visitorHash,
} from './_lib/visitor'

interface Env {
  DB: D1Database
  /** 訪問者符号のソルト（Pages のシークレット・任意）。 */
  ANALYTICS_SALT?: string
}

/** 1 訪問者あたりの受け付け上限（件/分）。素朴な水増しを止めるだけの安全弁。 */
const HITS_PER_MINUTE = 60

const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  if (!env.DB) return noContent()

  // 計測対象は本番の 2 サイトだけ。stg・プレビュー（*.pages.dev）と localhost は
  // 許可リストに無いので自然に落ちる＝開発中のアクセスが混ざらない。
  const site = siteOf(hostOfOrigin(request.headers.get('origin') ?? ''))
  if (!site) return noContent()

  const ua = request.headers.get('user-agent') ?? ''
  if (!ua || isBot(ua)) return noContent()

  const ip = request.headers.get('cf-connecting-ip') ?? ''
  if (!ip) return noContent()

  let body: { p?: unknown; r?: unknown }
  try {
    body = JSON.parse(await request.text())
  } catch {
    return noContent()
  }

  const now = Date.now()
  const date = jstDate(now)
  const visitor = await visitorHash({
    salt: env.ANALYTICS_SALT ?? 'cotonoha',
    date,
    ip,
    family: uaFamily(ua),
    site,
  })

  if (!(await checkRateLimit(env.DB, `hit:${visitor}`, now, HITS_PER_MINUTE))) return noContent()

  // 2 回目以降は hits を進めるだけ。着地パス・参照元は「その日の最初」を残したいので更新しない。
  await env.DB.prepare(
    `INSERT INTO visitor_days
       (date, site, visitor, first_seen, hits, landing_path, referer_host, country, device)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(date, site, visitor) DO UPDATE SET hits = hits + 1`,
  )
    .bind(
      date,
      site,
      visitor,
      now,
      normalizePath(body.p),
      refererHostOf(body.r),
      (request.headers.get('cf-ipcountry') ?? '').slice(0, 2),
      deviceOf(ua),
    )
    .run()

  return noContent()
}
