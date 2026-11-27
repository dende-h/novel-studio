import { z } from 'zod'

const dateMs = z
  .number()
  .int()
  .min(1)
  .max(Date.UTC(9999, 11, 31))
export const EventScheduleInputSchema = z.object({
  requestId: z.uuid(),
  startsAt: z.union([dateMs, z.literal('now')]),
  endsAt: dateMs,
})

export const EventStatusSchema = z.enum(['upcoming', 'active', 'ended', 'cancelled'])
export type EventStatus = z.infer<typeof EventStatusSchema>
export const eventStatusLabel: Record<EventStatus, string> = {
  upcoming: '開催前',
  active: '開催中',
  ended: '終了',
  cancelled: '中止',
}

export const EventScheduleSchema = z.object({
  startsAt: dateMs,
  endsAt: dateMs,
  cancelledAt: dateMs.nullable(),
})
type EventSchedule = z.infer<typeof EventScheduleSchema>

export function eventStatusOf(event: EventSchedule, now: number): EventStatus {
  if (event.cancelledAt !== null) return 'cancelled'
  if (now < event.startsAt) return 'upcoming'
  return now < event.endsAt ? 'active' : 'ended'
}

export const EventParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  workUrl: z.string().nullable().catch(null),
})
export const EventParticipantsSchema = z.object({
  participants: z.array(EventParticipantSchema),
  nextCursor: z.string().nullable(),
})

export const BoardEventDetailSchema = EventScheduleSchema.extend({
  revision: z.number().int(),
  participantCount: z.number().int(),
  myParticipation: z
    .object({ workUrl: z.string().nullable(), linkHidden: z.boolean().optional() })
    .nullable(),
  canParticipate: z.boolean(),
  canEdit: z.boolean(),
  canCancel: z.boolean(),
  serverNow: dateMs,
})

export type BoardEventDetail = z.infer<typeof BoardEventDetailSchema>

export const EventListGroupSchema = z.enum(['active', 'upcoming', 'past'])
export type EventListGroup = z.infer<typeof EventListGroupSchema>
const jst = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
export const formatBoardJst = (ms: number): string => jst.format(ms)
export const eventPeriod = (event: EventSchedule): string =>
  formatBoardJst(event.startsAt) + ' 〜 ' + formatBoardJst(event.endsAt) + '（JST）'

const JST_OFFSET = 9 * 60 * 60 * 1000
export const jstInputValue = (ms: number): string =>
  new Date(ms + JST_OFFSET).toISOString().slice(0, 16)

export function parseJstInput(value: string): number | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null
  const ms = Date.parse(value + ':00+09:00')
  return Number.isFinite(ms) && ms > 0 && jstInputValue(ms) === value ? ms : null
}

const LEAF_ORIGIN = 'https://cotonoha-leaf.org'
const STAGING_ORIGIN = 'https://stg.novel-studio-b2m.pages.dev'

export const eventShareOrigin = (origin?: string): string =>
  origin === STAGING_ORIGIN ? STAGING_ORIGIN : LEAF_ORIGIN

export const eventShareUrl = (threadId: string, origin?: string): string =>
  eventShareOrigin(origin) + '/events/' + encodeURIComponent(threadId)

export function parseEventWorkUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url.href
      : null
  } catch {
    return null
  }
}

export const EventParticipationInputSchema = z.object({
  workUrl: z.string().trim().max(2048).nullable().optional(),
})
