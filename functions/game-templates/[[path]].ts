/// <reference types="@cloudflare/workers-types" />
/**
 * /game-templates/* — 運営テンプレ（背景・立ち絵）の公開読み口（D-GAME-TEMPLATE-CMS）。
 *
 *   GET /game-templates/manifest.json              … 目録（短命キャッシュ）
 *   GET /game-templates/<kind>/<slug>.webp         … 実体（`?v=<hash>` 付きで immutable）
 *   GET /game-templates/<kind>/<slug>.thumb.webp   … サムネ
 *
 * `/api/*` の外に置く理由：アプリの SW は `/api/*` を絶対にキャッシュしない決まりなので、
 * 画像はその外で CacheFirst にする（vite.config.ts の runtimeCaching）。認証は無い＝
 * テンプレは誰でも使える公開物。書き込みの口はここには無い（管理 API は staff だけ）。
 */

import { isTemplateSlug, TEMPLATE_EXTS, type TemplateKind } from '../../src/core/game/templates'
import {
  readTemplateManifest,
  TEMPLATE_MANIFEST_KEY,
  templateObjectKey,
} from '../api/_lib/templates-store'

interface Env {
  MEDIA: R2Bucket
}

/**
 * `bg/room-day.webp` / `sprite/silhouette-woman.thumb.png` / `se/weather-rain.mp3` を分解する。
 * 形が違えば null。拡張子は目録の MIME から決まるもの（TEMPLATE_EXTS）だけ。
 */
export function parseTemplateObjectPath(
  path: string,
): { kind: TemplateKind; slug: string; thumb: boolean; ext: string } | null {
  const m = /^(bg|sprite|se)\/([a-z0-9-]+?)(\.thumb)?\.([a-z0-9]+)$/.exec(path)
  const kind = m?.[1]
  const slug = m?.[2]
  const ext = m?.[4]
  if (!kind || !slug || !ext || !isTemplateSlug(slug) || !TEMPLATE_EXTS.includes(ext)) return null
  if (kind === 'se' && m[3]) return null // 効果音にサムネは無い
  return { kind: kind as TemplateKind, slug, thumb: Boolean(m[3]), ext }
}

const notFound = () =>
  new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } })

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const url = new URL(request.url)
  const rel = url.pathname.replace(/^\/game-templates\/?/, '')

  if (rel === 'manifest.json') {
    // 目録は変わりうるので短命。管理ページは別口（/api/admin/templates・no-store）で最新を読む
    const obj = await env.MEDIA.get(TEMPLATE_MANIFEST_KEY)
    const body = obj
      ? new TextDecoder().decode(await obj.arrayBuffer())
      : JSON.stringify(await readTemplateManifest(env.MEDIA))
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300',
      },
    })
  }

  const parsed = parseTemplateObjectPath(rel)
  if (!parsed) return notFound()
  const obj = await env.MEDIA.get(
    templateObjectKey(parsed.kind, parsed.slug, parsed.thumb ? 'thumb' : 'full', parsed.ext),
  )
  if (!obj) return notFound()
  const headers = new Headers({
    'content-type':
      obj.httpMetadata?.contentType ?? (parsed.kind === 'se' ? 'audio/mpeg' : 'image/webp'),
    // URL に内容ハッシュ（?v=）が付く前提。置き換えたら URL が変わるので、ここは永久キャッシュでよい
    'cache-control': 'public, max-age=31536000, immutable',
  })
  if (obj.httpEtag) headers.set('etag', obj.httpEtag)
  if (request.method === 'HEAD') return new Response(null, { headers })
  return new Response(await obj.arrayBuffer(), { headers })
}
