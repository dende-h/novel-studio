/// <reference types="@cloudflare/workers-types" />
import {
  eventPeriod,
  eventShareUrl,
  eventStatusLabel,
  eventStatusOf,
  LEAF_ORIGIN,
} from '../../src/core/board/events'
import { boardBodyToPlain, escapeHtml } from '../../src/core/board/render'
import { publicEvent } from '../api/_lib/board-event-store'

const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}
const styles =
  '<style>body{background:#f6f7f0;color:#24332a;font:1rem/1.7 system-ui,sans-serif;margin:0;padding:2rem 1rem}main{background:white;border:1px solid #dce4d8;border-radius:1rem;margin:3vh auto;max-width:40rem;padding:clamp(1rem,5vw,2.5rem)}h1{line-height:1.25;overflow-wrap:anywhere}p{overflow-wrap:anywhere}a{color:#24583d}nav{display:flex;gap:1rem;flex-wrap:wrap}</style>'

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ params, env }) => {
  const id = params.threadId
  const event = typeof id === 'string' && id.length <= 100 ? await publicEvent(env.DB, id) : null
  if (!event || typeof id !== 'string') {
    return new Response(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>イベントが見つかりません</title>' +
        styles +
        '<main><h1>イベントが見つかりません</h1><a href="/#/board">掲示板へ</a></main></html>',
      { status: 404, headers },
    )
  }

  const schedule = {
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    cancelledAt: event.cancelled_at,
  }
  const state = eventStatusOf(schedule, Date.now())
  const period = escapeHtml(eventPeriod(schedule))
  const status = eventStatusLabel[state]
  const title = escapeHtml(event.title)
  const url = escapeHtml(eventShareUrl(id))
  const card = LEAF_ORIGIN + '/lp/ogp.png'
  const thread = '/#/board/' + encodeURIComponent(id)
  const join =
    state === 'active' || state === 'upcoming'
      ? '<a href="' + thread + '?action=join">参加する</a>'
      : ''
  const description = escapeHtml(boardBodyToPlain(event.body)).replace(/\r?\n/g, '<br>')
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} | コトノハ-leaf-</title><link rel="canonical" href="${url}">
    <meta property="og:type" content="website"><meta property="og:site_name" content="コトノハ-leaf-">
    <meta property="og:url" content="${url}"><meta property="og:title" content="${title}">
    <meta property="og:description" content="${period}"><meta property="og:image" content="${card}">
    <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${period}"><meta name="twitter:image" content="${card}">
    ${styles}</head><body><main>
    <a href="/">コトノハ-leaf-</a><h1>${title}</h1>
    <p>${status}</p><p>${period}</p><p>${description}</p>
    <nav aria-label="イベント"><a href="${thread}">イベントを見る</a>${join}
    <a href="${thread}?action=reply">返信する</a></nav>
    </main></body></html>`
  return new Response(html, { headers })
}
