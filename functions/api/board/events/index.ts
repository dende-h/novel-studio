import { EventPatchInputSchema } from '../../../../src/core/board/types'
import { verifyUserId } from '../../_lib/auth'
import { listEventParticipants, patchBoardEvent, publicEvent } from '../../_lib/board-event-store'
import { readProfile } from '../../_lib/board-store'
import { type BoardEnv, boardJson, rateLimitedResponse } from '../board-endpoint'

export const onRequestGet: PagesFunction<BoardEnv> = async ({ request, env }) => {
  const query = new URL(request.url).searchParams
  const threadId = query.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)
  if (!(await publicEvent(env.DB, threadId))) return boardJson({ error: 'not_found' }, 404)
  return boardJson(await listEventParticipants(env.DB, threadId, query.get('cursor')))
}

export const onRequestPatch: PagesFunction<BoardEnv> = async ({ request, env }) => {
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const threadId = new URL(request.url).searchParams.get('thread')
  if (!threadId) return boardJson({ error: 'missing_thread' }, 400)
  const parsed = EventPatchInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return boardJson({ error: 'bad_request' }, 400)
  const { DB: db } = env
  const [event, profile] = await Promise.all([publicEvent(db, threadId), readProfile(db, userId)])
  if (!event) return boardJson({ error: 'not_found' }, 404)
  const patch = parsed.data
  if (
    !profile ||
    profile.deleted_at ||
    (event.host_id !== userId && !(profile.role === 'staff' && patch.action === 'cancel'))
  ) {
    return boardJson({ error: 'forbidden' }, 403)
  }
  const now = Date.now()
  if (patch.action === 'edit' && profile.banned_until > now) {
    return boardJson({ error: 'banned', bannedUntil: profile.banned_until }, 403)
  }
  const invalidDates = (currentStart: number, at: number) =>
    patch.action === 'edit' &&
    (patch.startsAt >= patch.endsAt ||
      patch.endsAt <= at ||
      (patch.startsAt !== currentStart && (currentStart <= at || patch.startsAt < at)))
  if (patch.action === 'edit' && patch.revision !== event.revision)
    return boardJson({ error: 'event_changed' }, 409)
  if (invalidDates(event.starts_at, now)) return boardJson({ error: 'bad_event_dates' }, 400)

  const limited = await rateLimitedResponse(db, userId, now)
  if (limited) return limited
  if (patch.action === 'cancel' && event.cancelled_at !== null) return boardJson({ ok: true })
  if (await patchBoardEvent(db, threadId, userId, patch, Date.now())) return boardJson({ ok: true })

  const current = await publicEvent(db, threadId)
  if (!current) return boardJson({ error: 'not_found' }, 404)
  if (patch.action === 'cancel' && current.cancelled_at !== null) return boardJson({ ok: true })
  if (
    patch.action === 'edit' &&
    patch.revision === current.revision &&
    invalidDates(current.starts_at, Date.now())
  )
    return boardJson({ error: 'bad_event_dates' }, 400)
  return boardJson({ error: 'event_changed' }, 409)
}
