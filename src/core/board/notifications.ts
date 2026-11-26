import { z } from 'zod'

export const NotificationScopeSchema = z.enum(['all', 'related', 'off'])
export type NotificationScope = z.infer<typeof NotificationScopeSchema>
export const notificationScopeLabel: Record<NotificationScope, string> = {
  all: '掲示板の新着',
  related: '自分に関係する新着',
  off: 'オフ',
}

export const BOARD_SILENT_MS = 24 * 60 * 60 * 1000

export const BoardNotificationSchema = z.object({
  id: z.number().int().positive(),
  threadId: z.string(),
  title: z.string(),
  actorName: z.string(),
  postSeq: z.number().int().nullable(),
  kind: z.enum(['thread', 'reply', 'event_rescheduled', 'event_cancelled']),
  createdAt: z.number(),
  unread: z.boolean(),
})
export type BoardNotification = z.infer<typeof BoardNotificationSchema>

export const BoardNotificationResponseSchema = z.object({
  scope: NotificationScopeSchema,
  silentUntil: z.number().nullable(),
  serverNow: z.number(),
  unreadCount: z.number().int().nonnegative().optional(),
  unreadThreadIds: z.array(z.string()).optional(),
  notifications: z.array(BoardNotificationSchema).optional(),
  nextCursor: z.string().nullable().optional(),
  readToken: z.string().nullable().optional(),
})
export type BoardNotificationResponse = z.infer<typeof BoardNotificationResponseSchema>
