// t is the board thread and head is its seq=1 post.
export const PUBLIC_EVENT = `t.kind = 'event' AND t.deleted_at = 0 AND t.hidden_at = 0
  AND head.deleted_at = 0 AND head.hidden_at = 0`

export const eventJoin = `FROM board_events e
  JOIN board_threads t ON t.id = e.thread_id
  JOIN board_posts head ON head.thread_id = t.id AND head.seq = 1`

export const publicEventExists = (threadIdExpression: string): string =>
  `EXISTS (SELECT 1 ${eventJoin} WHERE t.id = ${threadIdExpression} AND ${PUBLIC_EVENT})`
