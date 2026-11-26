import type { BoardNotification, NotificationScope } from '../../../src/core/board/notifications'
import { RETIRED_AUTHOR_NAME } from './board-store'

interface NotificationState {
  scope: NotificationScope
  silent_until: number | null
}

export async function notificationState(
  db: D1Database,
  userId: string,
): Promise<NotificationState> {
  const select = db
    .prepare('SELECT scope, silent_until FROM board_notification_state WHERE user_id = ?')
    .bind(userId)
  const existing = await select.first<NotificationState>()
  if (existing) return existing
  await db
    .prepare(
      'INSERT OR IGNORE INTO board_notification_state (user_id, enabled_after) SELECT ?, COALESCE(MAX(id), 0) FROM board_activity',
    )
    .bind(userId)
    .run()
  const created = await select.first<NotificationState>()
  if (!created) throw new Error('Notification state missing')
  return created
}

export async function setNotificationScope(
  db: D1Database,
  userId: string,
  scope: NotificationScope,
): Promise<void> {
  await notificationState(db, userId)
  await db
    .prepare(
      'UPDATE board_notification_state SET enabled_after = CASE WHEN scope = ? AND ? <> ? THEN (SELECT COALESCE(MAX(id), 0) FROM board_activity) ELSE enabled_after END, scope = ? WHERE user_id = ?',
    )
    .bind('off', scope, 'off', scope, userId)
    .run()
}

export async function setNotificationSilence(
  db: D1Database,
  userId: string,
  until: number | null,
): Promise<void> {
  await notificationState(db, userId)
  await db
    .prepare('UPDATE board_notification_state SET silent_until = ? WHERE user_id = ?')
    .bind(until, userId)
    .run()
}

const eligible = `WITH eligible AS (
  SELECT a.id, a.thread_id, t.title, a.kind, a.created_at, p.seq,
    pr.display_name, pr.deleted_at AS author_deleted,
    a.id > MAX(ns.read_through, CASE WHEN a.post_id IS NULL
      THEN COALESCE(r.event_through, 0) ELSE COALESCE(r.post_through, 0) END) AS unread
  FROM board_notification_state ns
  JOIN board_activity a ON a.id > ns.enabled_after AND a.created_at >= ?
  JOIN board_threads t ON t.id = a.thread_id AND t.deleted_at = 0 AND t.hidden_at = 0
  LEFT JOIN board_posts p ON p.id = a.post_id
  LEFT JOIN board_profiles pr ON pr.user_id = a.actor_id
  LEFT JOIN board_thread_reads r ON r.user_id = ns.user_id AND r.thread_id = a.thread_id
  WHERE ns.user_id = ? AND ns.scope <> 'off' AND COALESCE(ns.silent_until, 0) <= ?
    AND a.actor_id <> ns.user_id
    AND (t.kind <> 'event' OR EXISTS (
      SELECT 1 FROM board_posts head WHERE head.thread_id = t.id AND head.seq = 1
        AND head.deleted_at = 0 AND head.hidden_at = 0
    ))
    AND CASE WHEN a.post_id IS NULL THEN EXISTS (
      SELECT 1 FROM board_event_participants ep
      JOIN board_profiles participant ON participant.user_id = ep.user_id AND participant.deleted_at = 0
      WHERE ep.thread_id = t.id AND ep.user_id = ns.user_id AND ep.withdrawn_at IS NULL
        AND ep.hidden_at = 0 AND ep.joined_after < a.id
    ) ELSE p.deleted_at = 0 AND p.hidden_at = 0 AND (
      ns.scope = 'all' OR t.user_id = ns.user_id OR EXISTS (
        SELECT 1 FROM board_posts own
        WHERE own.thread_id = t.id AND own.user_id = ns.user_id AND own.seq < p.seq
      )
    ) END
)`
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 20

export async function unreadThreadIds(
  db: D1Database,
  userId: string,
  now: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(eligible + ' SELECT DISTINCT thread_id FROM eligible WHERE unread')
    .bind(now - HISTORY_MS, userId, now)
    .all<{ thread_id: string }>()
  return results.map((row) => row.thread_id)
}

interface NotificationRow {
  id: number
  thread_id: string
  title: string
  kind: BoardNotification['kind']
  created_at: number
  seq: number | null
  display_name: string | null
  author_deleted: number | null
  unread: number
}

export async function listNotifications(
  db: D1Database,
  userId: string,
  now: number,
  rawCursor: string | null,
) {
  const cursor = rawCursor?.match(/^(\d+):(\d+)$/)
  const ceiling = cursor ? Number(cursor[1]) : null
  const before = cursor ? Number(cursor[2]) : null
  const { results } = await db
    .prepare(
      eligible +
        `,
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY unread DESC, id DESC) AS rank
      FROM eligible WHERE id <= COALESCE(?, (SELECT COALESCE(MAX(id), 0) FROM board_activity))
    )
    SELECT * FROM ranked WHERE rank = 1 AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    )
    .bind(now - HISTORY_MS, userId, now, ceiling, before, before, PAGE_SIZE + 1)
    .all<NotificationRow>()
  const page = results.slice(0, PAGE_SIZE)
  const first = page[0]
  const last = page.at(-1)
  const notifications: BoardNotification[] = page.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    title: row.title,
    actorName: row.author_deleted || !row.display_name ? RETIRED_AUTHOR_NAME : row.display_name,
    postSeq: row.seq,
    kind: row.kind,
    createdAt: row.created_at,
    unread: row.unread === 1,
  }))
  return {
    notifications,
    upper: first?.id ?? 0,
    nextCursor:
      first && last && results.length > PAGE_SIZE ? (ceiling ?? first.id) + ':' + last.id : null,
  }
}

export type ReadPosition = { all: number } | { thread: string; post: number; event: number }

export async function saveReadPosition(
  db: D1Database,
  userId: string,
  position: ReadPosition,
): Promise<void> {
  await notificationState(db, userId)
  if ('all' in position) {
    await db
      .prepare(
        'UPDATE board_notification_state SET read_through = MAX(read_through, ?) WHERE user_id = ?',
      )
      .bind(position.all, userId)
      .run()
  } else {
    await db
      .prepare(`
      INSERT INTO board_thread_reads (user_id, thread_id, post_through, event_through) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, thread_id) DO UPDATE SET
        post_through = MAX(board_thread_reads.post_through, excluded.post_through),
        event_through = MAX(board_thread_reads.event_through, excluded.event_through)`)
      .bind(userId, position.thread, position.post, position.event)
      .run()
  }
}
