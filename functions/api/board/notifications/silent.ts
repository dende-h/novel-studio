import { BOARD_SILENT_MS } from '../../../../src/core/board/notifications'
import { verifyUserId } from '../../_lib/auth'
import { setNotificationSilence } from '../../_lib/board-notification-store'
import { boardJson, rateLimitedResponse } from '../board-endpoint'
import type { NotificationEnv } from './index'

const changeSilence =
  (enable: boolean): PagesFunction<NotificationEnv> =>
  async ({ request, env }) => {
    const userId = await verifyUserId(request, env)
    if (!userId) return boardJson({ error: 'unauthorized' }, 401)
    const serverNow = Date.now()
    const limited = await rateLimitedResponse(env.DB, userId, serverNow)
    if (limited) return limited
    const silentUntil = enable ? serverNow + BOARD_SILENT_MS : null
    await setNotificationSilence(env.DB, userId, silentUntil)
    return boardJson({ silentUntil, serverNow })
  }

export const onRequestPut = changeSilence(true)
export const onRequestDelete = changeSilence(false)
