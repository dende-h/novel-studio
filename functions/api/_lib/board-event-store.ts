import type { BoardEventDetail } from '../../../src/core/board/events'
import type { EventPatchInput } from '../../../src/core/board/types'
import { prepareThreadInsert } from './board-store'

// t is the board thread and head is its seq=1 post.
export const PUBLIC_EVENT = `t.kind = 'event' AND t.deleted_at = 0 AND t.hidden_at = 0
  AND head.deleted_at = 0 AND head.hidden_at = 0`

const eventJoin = `FROM board_events e
  JOIN board_threads t ON t.id = e.thread_id
  JOIN board_posts head ON head.thread_id = t.id AND head.seq = 1`

const activeParticipant = 'ep.withdrawn_at IS NULL AND ep.hidden_at = 0'
const participantJoin = `FROM board_event_participants ep
  JOIN board_profiles pr ON pr.user_id = ep.user_id AND pr.deleted_at = 0`

interface EventRow {
  thread_id: string
  host_id: string
  starts_at: number
  ends_at: number
  cancelled_at: number | null
  revision: number
  title: string
  body: string
}
interface EventDetailRow extends EventRow {
  participant_count: number
  my_participant: string | null
  my_work_url: string | null
  my_link_hidden: number | null
  can_write: number
  activity_id: number
}

export function prepareEventDetail(
  db: D1Database,
  threadId: string,
  viewer: string | null,
  now: number,
) {
  return db
    .prepare(`
    SELECT e.*, t.title, head.body,
      (SELECT COUNT(*) ${participantJoin}
        WHERE ep.thread_id = t.id AND ${activeParticipant}) AS participant_count,
      mine.id AS my_participant, mine.work_url AS my_work_url, mine.link_hidden_at AS my_link_hidden,
      EXISTS (SELECT 1 FROM board_profiles pr WHERE pr.user_id = ?1 AND pr.deleted_at = 0
        AND pr.banned_until <= ?2) AS can_write,
      (SELECT COALESCE(MAX(a.id), 0) FROM board_activity a
        WHERE a.thread_id = t.id AND a.post_id IS NULL) AS activity_id
    ${eventJoin}
    LEFT JOIN board_event_participants mine ON mine.thread_id = t.id AND mine.user_id = ?1
      AND mine.withdrawn_at IS NULL
    WHERE t.id = ?3 AND ${PUBLIC_EVENT}`)
    .bind(viewer, now, threadId)
}

export function toEventDetail(
  row: EventDetailRow,
  viewer: string | null,
  now: number,
): BoardEventDetail {
  const host = viewer === row.host_id
  return {
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cancelledAt: row.cancelled_at,
    revision: row.revision,
    participantCount: row.participant_count,
    myParticipation: row.my_participant
      ? { workUrl: row.my_work_url, linkHidden: Boolean(row.my_link_hidden) }
      : null,
    canParticipate: Boolean(row.can_write) && !row.cancelled_at && now < row.ends_at,
    canEdit: host && Boolean(row.can_write) && !row.cancelled_at && now < row.ends_at,
    canCancel: host && !row.cancelled_at,
    serverNow: now,
  }
}
export type { EventDetailRow }

export function publicEvent(db: D1Database, threadId: string): Promise<EventRow | null> {
  return db
    .prepare(`SELECT e.*, t.title, head.body ${eventJoin}
    WHERE t.id = ? AND ${PUBLIC_EVENT}`)
    .bind(threadId)
    .first<EventRow>()
}

interface EventCreation {
  id: string
  postId: string
  title: string
  body: string
  userId: string
  requestId: string
  startsAt: number
  endsAt: number
  now: number
}

export function findEventRequest(db: D1Database, userId: string, requestId: string) {
  return db
    .prepare(`
    SELECT e.thread_id AS id, p.id AS postId, 1 AS seq, e.starts_at AS startsAt, e.ends_at AS endsAt FROM board_events e
    JOIN board_posts p ON p.thread_id = e.thread_id AND p.seq = 1
    WHERE e.host_id = ? AND e.request_id = ?`)
    .bind(userId, requestId)
    .first<{ id: string; postId: string; seq: number; startsAt: number; endsAt: number }>()
}

export async function createBoardEvent(db: D1Database, input: EventCreation) {
  try {
    await db.batch([
      prepareThreadInsert(db, { ...input, kind: 'event' }),
      db
        .prepare(`INSERT INTO board_posts (id, thread_id, seq, user_id, body, created_at)
        VALUES (?, ?, 1, ?, ?, ?)`)
        .bind(input.postId, input.id, input.userId, input.body, input.now),
      db
        .prepare(`INSERT INTO board_events
        (thread_id, host_id, request_id, starts_at, ends_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          input.id,
          input.userId,
          input.requestId,
          input.startsAt,
          input.endsAt,
          input.now,
          input.userId,
        ),
    ])
  } catch (error) {
    const existing = await findEventRequest(db, input.userId, input.requestId)
    if (existing) return existing
    throw error
  }
  return {
    id: input.id,
    postId: input.postId,
    seq: 1,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  }
}

const publicThreadExists = `EXISTS (
  SELECT 1 FROM board_threads t
  JOIN board_posts head ON head.thread_id = t.id AND head.seq = 1
  WHERE t.id = board_events.thread_id AND ${PUBLIC_EVENT}
)`

export async function patchBoardEvent(
  db: D1Database,
  threadId: string,
  actorId: string,
  patch: EventPatchInput,
  now: number,
): Promise<boolean> {
  if (patch.action === 'cancel') {
    const result = await db
      .prepare(`
      UPDATE board_events SET cancelled_at = ?1, updated_at = ?1, updated_by = ?2, revision = revision + 1
      WHERE thread_id = ?3 AND cancelled_at IS NULL AND ${publicThreadExists}
      AND (host_id = ?2 OR EXISTS (
        SELECT 1 FROM board_profiles pr WHERE pr.user_id = ?2 AND pr.role = 'staff' AND pr.deleted_at = 0
      ))`)
      .bind(now, actorId, threadId)
      .run()
    return result.meta.changes > 0
  }

  const { startsAt, endsAt, revision, title, body } = patch
  const [result] = await db.batch([
    db
      .prepare(`
      UPDATE board_events SET starts_at = ?1, ends_at = ?2, updated_at = ?3,
        updated_by = ?4, revision = revision + 1
      WHERE thread_id = ?5 AND revision = ?6 AND host_id = ?4 AND cancelled_at IS NULL
        AND ?3 < ends_at AND ?3 < ?2 AND ?1 < ?2
        AND (starts_at = ?1 OR (starts_at > ?3 AND ?1 >= ?3))
        AND ${publicThreadExists}
        AND EXISTS (SELECT 1 FROM board_profiles pr WHERE pr.user_id = ?4 AND pr.deleted_at = 0 AND pr.banned_until <= ?3)
    `)
      .bind(startsAt, endsAt, now, actorId, threadId, revision),
    db
      .prepare('UPDATE board_threads SET title = ? WHERE id = ? AND changes() > 0')
      .bind(title, threadId),
    db
      .prepare('UPDATE board_posts SET body = ? WHERE thread_id = ? AND seq = 1 AND changes() > 0')
      .bind(body, threadId),
    db
      .prepare(`DELETE FROM board_post_links WHERE changes() > 0
      AND post_id = (SELECT id FROM board_posts WHERE thread_id = ? AND seq = 1)`)
      .bind(threadId),
  ])
  return (result?.meta.changes ?? 0) > 0
}

export async function setEventParticipation(
  db: D1Database,
  threadId: string,
  userId: string,
  now: number,
  workUrl: string | null | undefined,
): Promise<boolean> {
  if (workUrl === null) {
    // An existing participant can remove their link even after the deadline or a ban.
    const removed = await db
      .prepare(`UPDATE board_event_participants SET work_url = NULL
      WHERE thread_id = ? AND user_id = ? AND withdrawn_at IS NULL`)
      .bind(threadId, userId)
      .run()
    if (removed.meta.changes > 0) return true
  }
  const result = await db
    .prepare(`
    INSERT INTO board_event_participants (id, thread_id, user_id, joined_at, joined_after, work_url)
    SELECT ?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(id), 0) FROM board_activity), ?5
    ${eventJoin}
    JOIN board_profiles pr ON pr.user_id = ?3 AND pr.deleted_at = 0 AND pr.banned_until <= ?4
    WHERE t.id = ?2 AND ${PUBLIC_EVENT} AND e.cancelled_at IS NULL AND ?4 < e.ends_at
    ON CONFLICT (thread_id, user_id) DO UPDATE SET
      joined_at = CASE WHEN withdrawn_at IS NULL THEN joined_at ELSE excluded.joined_at END,
      joined_after = CASE WHEN withdrawn_at IS NULL THEN joined_after ELSE excluded.joined_after END,
      work_url = CASE WHEN ?6 = 1 THEN excluded.work_url ELSE work_url END,
      withdrawn_at = NULL
    WHERE hidden_at = 0
  `)
    .bind(
      crypto.randomUUID(),
      threadId,
      userId,
      now,
      workUrl ?? null,
      workUrl !== undefined ? 1 : 0,
    )
    .run()
  return result.meta.changes > 0
}

export async function withdrawEventParticipation(
  db: D1Database,
  threadId: string,
  userId: string,
  now: number,
) {
  await db
    .prepare(`UPDATE board_event_participants SET withdrawn_at = ?, work_url = NULL
    WHERE thread_id = ? AND user_id = ? AND withdrawn_at IS NULL`)
    .bind(now, threadId, userId)
    .run()
}

const PARTICIPANT_PAGE = 20
export async function listEventParticipants(
  db: D1Database,
  threadId: string,
  rawCursor: string | null,
) {
  const cursor = rawCursor?.match(/^(\d+):([\w-]+)$/)
  const after = cursor ? Number(cursor[1]) : null
  const { results } = await db
    .prepare(`
    SELECT ep.id, pr.display_name AS name, ep.joined_at,
      CASE WHEN ep.link_hidden_at = 0 THEN ep.work_url END AS work_url
    ${participantJoin}
    WHERE ep.thread_id = ?1 AND ${activeParticipant}
      AND EXISTS (SELECT 1 ${eventJoin} WHERE t.id = ep.thread_id AND ${PUBLIC_EVENT})
      AND (?2 IS NULL OR (ep.joined_at, ep.id) > (?2, ?3))
    ORDER BY ep.joined_at, ep.id LIMIT ?4`)
    .bind(threadId, after, cursor?.[2] ?? null, PARTICIPANT_PAGE + 1)
    .all<{ id: string; name: string; joined_at: number; work_url: string | null }>()
  const page = results.slice(0, PARTICIPANT_PAGE)
  const last = page.at(-1)
  return {
    participants: page.map((row) => ({ id: row.id, name: row.name, workUrl: row.work_url })),
    nextCursor: last && results.length > PARTICIPANT_PAGE ? last.joined_at + ':' + last.id : null,
  }
}

export function findReportedEventLink(db: D1Database, id: string) {
  return db
    .prepare(`
    SELECT ep.work_url AS url, head.id AS post_id FROM board_event_participants ep
    ${eventJoin.replace('FROM board_events e', 'JOIN board_events e ON e.thread_id = ep.thread_id')}
    JOIN board_profiles pr ON pr.user_id = ep.user_id AND pr.deleted_at = 0
    WHERE ep.id = ? AND ${activeParticipant} AND ${PUBLIC_EVENT}
      AND ep.link_hidden_at = 0 AND ep.work_url IS NOT NULL`)
    .bind(id)
    .first<{ url: string; post_id: string }>()
}

export async function moderateEventLink(db: D1Database, id: string, hiddenAt: number) {
  const result = await db
    .prepare('UPDATE board_event_participants SET link_hidden_at = ? WHERE id = ?')
    .bind(hiddenAt, id)
    .run()
  return result.meta.changes > 0
}
