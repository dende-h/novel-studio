/// <reference types="@cloudflare/workers-types" />
import { verifyWebhook } from '@clerk/backend/webhooks'
import { markProfileDeleted } from '../_lib/board-store'

interface Env {
  CLERK_WEBHOOK_SECRET?: string
  DB: D1Database
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.CLERK_WEBHOOK_SECRET) return new Response(null, { status: 503 })
  let event: Awaited<ReturnType<typeof verifyWebhook>>
  try {
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SECRET })
  } catch {
    return new Response(null, { status: 400 })
  }

  if (event.type === 'user.deleted' && event.data.id) {
    await markProfileDeleted(env.DB, event.data.id, Date.now())
  }
  return new Response(null, { status: 204 })
}
