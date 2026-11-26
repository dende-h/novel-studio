/// <reference types="@cloudflare/workers-types" />
import { type ClerkEnv, verifyUserId } from '../../_lib/auth'
import {
  listNotifications,
  notificationState,
  unreadThreadIds,
} from '../../_lib/board-notification-store'
import { boardReadToken } from '../../_lib/board-read-token'
import { boardJson } from '../board-endpoint'

export interface NotificationEnv extends ClerkEnv {
  DB: D1Database
}

export const onRequestGet: PagesFunction<NotificationEnv> = async ({ request, env }) => {
  const now = Date.now()
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const state = await notificationState(env.DB, userId)
  const silentUntil = (state.silent_until ?? 0) > now ? state.silent_until : null
  const response = { scope: state.scope, silentUntil, serverNow: now }
  if (silentUntil || state.scope === 'off') return boardJson(response)

  const query = new URL(request.url).searchParams
  if (query.get('summary') === '1') {
    const ids = await unreadThreadIds(env.DB, userId, now)
    return boardJson({ ...response, unreadCount: ids.length, unreadThreadIds: ids })
  }
  const { notifications, upper, nextCursor } = await listNotifications(
    env.DB,
    userId,
    now,
    query.get('cursor'),
  )
  const readToken = upper
    ? await boardReadToken(env.CLERK_SECRET_KEY, userId, { all: upper })
    : null
  return boardJson({ ...response, notifications, nextCursor, readToken })
}
