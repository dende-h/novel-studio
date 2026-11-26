import { NotificationScopeSchema } from '../../../../src/core/board/notifications'
import { verifyUserId } from '../../_lib/auth'
import { setNotificationScope } from '../../_lib/board-notification-store'
import { boardJson } from '../board-endpoint'
import type { NotificationEnv } from './index'

export const onRequestPut: PagesFunction<NotificationEnv> = async ({ request, env }) => {
  const userId = await verifyUserId(request, env)
  if (!userId) return boardJson({ error: 'unauthorized' }, 401)
  const body = await request.json<{ scope?: unknown }>().catch(() => null)
  const scope = NotificationScopeSchema.safeParse(body?.scope)
  if (!scope.success) return boardJson({ error: 'bad_request' }, 400)
  await setNotificationScope(env.DB, userId, scope.data)
  return boardJson({ ok: true })
}
