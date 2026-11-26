import { verifyUserId } from '../../_lib/auth'
import { saveReadPosition } from '../../_lib/board-notification-store'
import { verifyBoardReadToken } from '../../_lib/board-read-token'
import { boardJson } from '../board-endpoint'
import type { NotificationEnv } from './index'

export const onRequestPost: PagesFunction<NotificationEnv> = async ({ request, env }) => {
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const body = await request.json<{ token?: unknown }>().catch(() => null)
  const token = body?.token
  if (typeof token !== 'string' || token.length > 2048)
    return boardJson({ error: 'bad_request' }, 400)
  const position = await verifyBoardReadToken(env.CLERK_SECRET_KEY, userId, token)
  if (!position) return boardJson({ error: 'bad_request' }, 400)
  await saveReadPosition(env.DB, userId, position)
  return boardJson({ ok: true })
}
