import { EventParticipationInputSchema, parseEventWorkUrl } from '../../../../src/core/board/events'
import { verifyUserId } from '../../_lib/auth'
import {
  publicEvent,
  setEventParticipation,
  withdrawEventParticipation,
} from '../../_lib/board-event-store'
import { readProfile } from '../../_lib/board-store'
import { type BoardEnv, boardJson, rateLimitedResponse } from '../board-endpoint'

export const onRequestPut: PagesFunction<BoardEnv> = async ({ request, env }) => {
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const threadId = new URL(request.url).searchParams.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)
  const parsed = EventParticipationInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)
  const raw = parsed.data.workUrl
  const workUrl = raw ? parseEventWorkUrl(raw) : raw
  if (raw && !workUrl) return boardJson({ error: 'bad_work_url' }, 400)

  const now = Date.now()
  const limited = await rateLimitedResponse(env.DB, userId, now)
  if (limited) return limited
  if (
    await setEventParticipation(
      env.DB,
      threadId,
      userId,
      Date.now(),
      workUrl || (raw === undefined ? undefined : null),
    )
  ) {
    return boardJson({ ok: true })
  }

  const [event, profile] = await Promise.all([
    publicEvent(env.DB, threadId),
    readProfile(env.DB, userId),
  ])
  if (!event) return boardJson({ error: 'not_found' }, 404)
  if (!profile || profile.deleted_at) return boardJson({ error: 'profile_required' }, 409)
  if (profile.banned_until > now)
    return boardJson({ error: 'banned', bannedUntil: profile.banned_until }, 403)
  return boardJson({ error: 'event_closed' }, 409)
}

export const onRequestDelete: PagesFunction<BoardEnv> = async ({ request, env }) => {
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const threadId = new URL(request.url).searchParams.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)
  const now = Date.now()
  const limited = await rateLimitedResponse(env.DB, userId, now)
  if (limited) return limited
  await withdrawEventParticipation(env.DB, threadId, userId, now)
  return boardJson({ ok: true })
}
