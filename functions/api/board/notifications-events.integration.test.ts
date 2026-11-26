// @vitest-environment node
import { createHmac } from 'node:crypto'

import { jstInputValue, parseJstInput } from '../../../src/core/board/events'
import { BOARD_SILENT_MS } from '../../../src/core/board/notifications'
import { onRequestGet as share } from '../../events/[threadId]'
import { hideThread, markProfileDeleted, setPostHidden } from '../_lib/board-store'
import { onRequestPost as clerkWebhook } from '../webhooks/clerk'
import { onRequestGet as participants, onRequestPatch as patchEvent } from './events/index'
import { onRequestDelete as leave, onRequestPut as participate } from './events/participation'
import { onRequestPost as moderate } from './moderate'
import { onRequestGet as notifications } from './notifications/index'
import { onRequestPost as read } from './notifications/read'
import { onRequestPut as settings } from './notifications/settings'
import { onRequestDelete as resume, onRequestPut as silence } from './notifications/silent'
import { onRequestPost as createReply } from './posts'
import { makeRealD1, type RealD1 } from './real-d1'
import { onRequestPost as report } from './reports'
import { onRequestGet as detail } from './thread'
import { onRequestPost as create, onRequestGet as threads } from './threads'

vi.mock('../_lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/auth')>()),
  verifyUserId: async (request: Request) => request.headers.get('authorization'),
}))

const NOW = Date.UTC(2026, 10, 27, 14, 45)
const HOUR = 3_600_000
let d: RealD1
let env: { DB: D1Database; CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  d = makeRealD1()
  env = { DB: d.db, CLERK_SECRET_KEY: 'local-test-token-key', CLERK_PUBLISHABLE_KEY: 'pk' }
  for (const [id, name] of [
    ['host', '主催者'],
    ['reader', '参加者'],
    ['other', '他の人'],
    ['staff', '運営'],
  ]) {
    d.seed.profile({
      user_id: id,
      display_name: name,
      name_key: id,
      role: id === 'staff' ? 'staff' : 'member',
    })
  }
})
afterEach(() => {
  vi.useRealTimers()
  d.close()
})

type Handler = (context: {
  request: Request
  env: typeof env
  params: { threadId?: string }
}) => Promise<Response>
async function call(
  handler: unknown,
  path: string,
  user?: string,
  method = 'GET',
  body?: unknown,
  threadId?: string,
) {
  return await (handler as Handler)({
    env,
    params: { threadId },
    request: new Request('https://local.test' + path, {
      method,
      headers: user ? { authorization: user } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  })
}

const notificationsPath = '/api/board/notifications'
const summary = async (user = 'reader') =>
  (await call(notifications, notificationsPath + '?summary=1', user)).json()
const inbox = async (query = '', user = 'reader') =>
  (await call(notifications, notificationsPath + query, user)).json()
const readToken = (token: string, user = 'reader') =>
  call(read, notificationsPath + '/read', user, 'POST', { token })
const scope = (scope: string) =>
  call(settings, notificationsPath + '/settings', 'reader', 'PUT', { scope })

function seededThread(id: string, user = 'host') {
  d.seed.thread({ id, user_id: user, title: 'スレッド ' + id, created_at: NOW, bumped_at: NOW })
  seededPost(id, 1, user)
}

function seededPost(id: string, seq: number, user: string, extra = {}) {
  return d.seed.post({
    id: id + '-' + seq,
    thread_id: id,
    seq,
    user_id: user,
    created_at: NOW,
    ...extra,
  })
}

const creation = (over: Record<string, unknown> = {}) => ({
  kind: 'event',
  title: '週末の <短編>',
  body: '作品を持ち寄ります。<script>alert(1)</script>',
  event: { requestId: crypto.randomUUID(), startsAt: 'now', endsAt: NOW + HOUR, ...over },
})

async function publish(input = creation()) {
  const result = await call(create, '/api/board/threads', 'host', 'POST', input)
  expect(result.status).toBe(201)
  return (await result.json()).id as string
}
const threadUrl = (id: string, seq?: number) =>
  '/api/board/thread?id=' + id + (seq ? '&post=' + seq : '')
const eventUrl = (id: string) => '/api/board/events?thread=' + id
const joinUrl = (id: string) => '/api/board/events/participation?thread=' + id

describe('アカウント単位の掲示板通知', () => {
  it('初回以前と自分の投稿を除外し、同時刻でも新着を失わず、公開可否を反映する', async () => {
    seededThread('old')
    expect((await summary()).unreadThreadIds).toEqual([])
    expect((await call(notifications, notificationsPath)).status).toBe(401)

    seededThread('new')
    const reply = await call(createReply, '/api/board/posts?thread=new', 'other', 'POST', {
      body: '実際の返信 API',
    })
    expect(reply.status).toBe(201)
    const { id: replyId } = await reply.json()
    seededPost('new', 3, 'reader')
    seededThread('own', 'reader')
    const box = await inbox()
    expect(box.notifications).toMatchObject([
      { threadId: 'new', kind: 'reply', postSeq: 2, unread: true, actorName: '他の人' },
    ])
    expect(box.notifications[0]).not.toHaveProperty('body')
    expect((await summary()).unreadThreadIds).toEqual(['new'])

    await setPostHidden(d.db, replyId, NOW)
    expect((await inbox()).notifications).toMatchObject([{ threadId: 'new', postSeq: 1 }])
    d.exec("UPDATE board_posts SET deleted_at = 1 WHERE id = 'new-1'")
    expect((await summary()).unreadThreadIds).toEqual([])
    await setPostHidden(d.db, replyId, 0)
    expect((await summary()).unreadThreadIds).toEqual(['new'])
    await hideThread(d.db, 'new', NOW)
    expect((await inbox()).notifications).toEqual([])
  })

  it('ページを開いた範囲だけ既読にし、別アカウントと改変されたトークンを拒否する', async () => {
    await summary()
    seededThread('long')
    for (let seq = 2; seq <= 55; seq++) seededPost('long', seq, 'other')
    const old = await (await call(detail, threadUrl('long', 2), 'reader')).json()
    expect(old.posts.map((p: { seq: number }) => p.seq)).toEqual([1, 2])
    expect(old.newerPost).toBe(52)
    expect((await readToken(old.readToken, 'other')).status).toBe(400)
    expect((await readToken(old.readToken.slice(0, -5) + 'test')).status).toBe(400)
    expect((await readToken(old.readToken)).status).toBe(200)
    expect((await summary()).unreadThreadIds).toEqual(['long'])

    const latest = await (await call(detail, threadUrl('long'), 'reader')).json()
    expect(latest.posts.length).toBe(51)
    expect(latest.olderPost).toBe(5)
    expect((await readToken(latest.readToken)).status).toBe(200)
    expect((await readToken(old.readToken)).status).toBe(200)
    expect((await summary()).unreadThreadIds).toEqual([])
    expect((await inbox()).notifications[0].unread).toBe(false)
  })

  it('一覧をページ化し、すべて既読の取得後に来た新着を残す', async () => {
    await summary()
    for (let i = 0; i < 24; i++) seededThread('page-' + i)
    const first = await inbox()
    expect(first.notifications).toHaveLength(20)
    seededPost('page-23', 2, 'host')
    const second = await inbox('?cursor=' + encodeURIComponent(first.nextCursor))
    expect(second.notifications).toHaveLength(4)
    expect(second.readToken).toBeNull()
    expect((await inbox('?cursor=9007199254740991:9007199254740991')).readToken).toBeNull()
    expect(
      new Set([...first.notifications, ...second.notifications].map((row) => row.threadId)).size,
    ).toBe(24)
    expect((await readToken(first.readToken)).status).toBe(200)
    expect((await summary()).unreadThreadIds).toEqual(['page-23'])
    const forgedCursor = await inbox('?cursor=999999:1')
    expect(forgedCursor.readToken).toBe(null)
    expect((await summary()).unreadThreadIds).toEqual(['page-23'])
  })

  it('通知対象の切り替え、停止のアカウント保存・途中解除・期限切れ・停止中の既読を扱う', async () => {
    await summary()
    expect((await scope('related')).status).toBe(200)
    seededThread('relation')
    seededPost('relation', 2, 'other')
    seededPost('relation', 3, 'reader')
    expect((await inbox()).notifications).toEqual([])
    seededPost('relation', 4, 'other', { reply_to: 3 })
    expect((await inbox()).notifications[0].postSeq).toBe(4)

    const stop = await call(silence, notificationsPath + '/silent', 'reader', 'PUT')
    expect(await stop.json()).toMatchObject({ silentUntil: NOW + BOARD_SILENT_MS })
    expect(await summary()).toEqual({
      scope: 'related',
      silentUntil: NOW + BOARD_SILENT_MS,
      serverNow: NOW,
    })
    expect((await inbox()).notifications).toBeUndefined()
    expect((await summary('other')).silentUntil).toBeNull()
    const shown = await (await call(detail, threadUrl('relation'), 'reader')).json()
    await readToken(shown.readToken)
    seededPost('relation', 5, 'other')
    expect((await call(resume, notificationsPath + '/silent', 'reader', 'DELETE')).status).toBe(200)
    expect((await inbox()).notifications).toMatchObject([{ postSeq: 5, unread: true }])

    await call(silence, notificationsPath + '/silent', 'reader', 'PUT')
    vi.setSystemTime(NOW + BOARD_SILENT_MS - 1)
    expect((await summary()).unreadThreadIds).toBeUndefined()
    vi.setSystemTime(NOW + BOARD_SILENT_MS)
    expect((await summary()).unreadThreadIds).toEqual(['relation'])
    await scope('off')
    seededPost('relation', 6, 'other', { created_at: Date.now() })
    await call(silence, notificationsPath + '/silent', 'reader', 'PUT')
    await call(resume, notificationsPath + '/silent', 'reader', 'DELETE')
    expect((await summary()).unreadThreadIds).toBeUndefined()
    await scope('all')
    expect((await summary()).unreadThreadIds).toEqual([])
  })

  it('既読の履歴も30日で一覧の対象外になる', async () => {
    await summary()
    seededThread('expired')
    const list = await inbox()
    await readToken(list.readToken)
    expect((await inbox()).notifications).toMatchObject([{ threadId: 'expired', unread: false }])
    vi.setSystemTime(NOW + 30 * 24 * HOUR + 1)
    expect((await inbox()).notifications).toEqual([])
  })
})

describe('公開イベント API', () => {
  it('冪等な作成、JSTの日付またぎ、開始と終了の境界、受付終了後の URL 削除と取り消し', async () => {
    const startsAt = parseJstInput('2026-11-28T00:00')
    const endsAt = parseJstInput('2026-11-28T01:00')
    expect(startsAt).toBe(Date.UTC(2026, 10, 27, 15))
    expect(jstInputValue(startsAt ?? 0)).toBe('2026-11-28T00:00')
    expect(parseJstInput('2026-02-30T12:00')).toBeNull()
    const input = creation({ startsAt, endsAt })
    expect((await call(create, '/api/board/threads', undefined, 'POST', input)).status).toBe(401)
    expect(
      (
        await call(
          create,
          '/api/board/threads',
          'host',
          'POST',
          creation({ startsAt, endsAt: startsAt }),
        )
      ).status,
    ).toBe(400)
    const responses = await Promise.all([
      call(create, '/api/board/threads', 'host', 'POST', input),
      call(create, '/api/board/threads', 'host', 'POST', input),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201])
    const [created, retried] = await Promise.all(responses.map((r) => r.json()))
    expect(retried).toEqual(created)
    expect(d.rows('SELECT kind FROM board_activity')).toEqual([{ kind: 'thread' }])
    const id = created.id
    const list = (group: string) =>
      call(threads, '/api/board/threads?kind=event&group=' + group).then((r) => r.json())
    expect((await list('upcoming')).threads).toMatchObject([{ id, event: { startsAt, endsAt } }])
    expect(
      (
        await call(participate, joinUrl(id), 'reader', 'PUT', {
          workUrl: 'https://user:pw@example.com/novel',
        })
      ).status,
    ).toBe(400)
    expect((await call(participate, joinUrl(id), undefined, 'PUT', {})).status).toBe(401)
    const joins = await Promise.all([
      call(participate, joinUrl(id), 'reader', 'PUT', { workUrl: 'https://example.com/novel' }),
      call(participate, joinUrl(id), 'reader', 'PUT', {}),
    ])
    expect(joins.map((r) => r.status)).toEqual([200, 200])
    expect((await (await call(detail, threadUrl(id))).json()).event).toMatchObject({
      participantCount: 1,
      myParticipation: null,
    })
    expect(
      (
        await (
          await call(threads, '/api/board/threads?kind=event&group=upcoming&mine=1', 'reader')
        ).json()
      ).threads,
    ).toMatchObject([{ id }])
    expect(
      (
        await (
          await call(threads, '/api/board/threads?kind=event&group=upcoming&mine=1', 'other')
        ).json()
      ).threads,
    ).toEqual([])
    vi.setSystemTime(startsAt ?? 0)
    expect((await list('upcoming')).threads).toEqual([])
    expect((await list('active')).threads).toMatchObject([{ id }])
    vi.setSystemTime(endsAt ?? 0)
    expect((await list('active')).threads).toEqual([])
    expect((await list('past')).threads).toMatchObject([{ id }])
    expect((await call(participate, joinUrl(id), 'other', 'PUT', {})).status).toBe(409)
    expect(
      (
        await call(participate, joinUrl(id), 'reader', 'PUT', {
          workUrl: 'https://example.com/new',
        })
      ).status,
    ).toBe(409)
    expect((await call(participate, joinUrl(id), 'reader', 'PUT', { workUrl: null })).status).toBe(
      200,
    )
    expect((await (await call(participants, eventUrl(id))).json()).participants).toMatchObject([
      { name: '参加者', workUrl: null },
    ])
    expect((await call(leave, joinUrl(id), 'reader', 'DELETE')).status).toBe(200)
    expect((await (await call(detail, threadUrl(id))).json()).event.participantCount).toBe(0)
  })

  it('参加後の日時変更と中止だけを通知し、古い返信を開いても新しい返信を既読にしない', async () => {
    await summary()
    await scope('related')
    const id = await publish()
    expect((await call(participate, joinUrl(id), 'reader', 'PUT', {})).status).toBe(200)
    seededPost(id, 2, 'reader')
    seededPost(id, 3, 'other')
    const edit = {
      action: 'edit',
      title: '新しいタイトル',
      body: '新しい説明',
      startsAt: NOW,
      endsAt: NOW + 2 * HOUR,
      revision: 1,
    }
    expect((await call(patchEvent, eventUrl(id), 'other', 'PATCH', edit)).status).toBe(403)
    expect((await call(patchEvent, eventUrl(id), 'host', 'PATCH', edit)).status).toBe(200)
    expect((await call(patchEvent, eventUrl(id), 'host', 'PATCH', edit)).status).toBe(409)
    expect((await inbox()).notifications).toMatchObject([
      { kind: 'event_rescheduled', postSeq: null, title: edit.title },
    ])
    const shown = await (await call(detail, threadUrl(id, 2), 'reader')).json()
    expect(shown.posts[0].body).toBe(edit.body)
    expect(shown.event.endsAt).toBe(edit.endsAt)
    await readToken(shown.readToken)
    expect((await inbox()).notifications).toMatchObject([
      { kind: 'reply', postSeq: 3, unread: true },
    ])

    expect(
      (await call(patchEvent, eventUrl(id), 'staff', 'PATCH', { action: 'cancel' })).status,
    ).toBe(200)
    expect((await call(participate, joinUrl(id), 'other', 'PUT', {})).status).toBe(409)
    expect((await inbox()).notifications).toMatchObject([
      { kind: 'event_cancelled', actorName: '運営' },
    ])
    expect((await (await call(detail, threadUrl(id))).json()).event.participantCount).toBe(1)
  })

  it('参加と中止を同時に送っても、有効に成立した参加だけを数える', async () => {
    const id = await publish()
    const [cancel, join] = await Promise.all([
      call(patchEvent, eventUrl(id), 'host', 'PATCH', { action: 'cancel' }),
      call(participate, joinUrl(id), 'reader', 'PUT', {}),
    ])
    expect(cancel.status).toBe(200)
    expect([200, 409]).toContain(join.status)
    const view = await (await call(detail, threadUrl(id))).json()
    expect(view.event).toMatchObject({
      cancelledAt: NOW,
      participantCount: join.status === 200 ? 1 : 0,
    })
    expect((await call(participate, joinUrl(id), 'other', 'PUT', {})).status).toBe(409)
  })

  it('作品リンクの通報と非表示、投稿禁止中の取り下げ、退会後の参加者除外、公開ページのカードと 404', async () => {
    const id = await publish()
    const shareUrl = '/events/' + id
    const guest = await call(share, shareUrl, undefined, 'GET', undefined, id)
    const html = await guest.text()
    expect(guest.status).toBe(200)
    expect(html).toContain('property="og:title" content="週末の &lt;短編&gt;"')
    expect(html).toContain('content="https://cotonoha-leaf.org/lp/ogp.png"')
    expect(html).toContain('?action=join')
    expect(html).toContain('?action=reply')
    expect(html).not.toContain('<script>')
    await call(participate, joinUrl(id), 'reader', 'PUT', { workUrl: 'https://example.com/work' })
    const listed = await (await call(participants, eventUrl(id))).json()
    const participantId = listed.participants[0].id
    expect(
      (await call(report, '/api/board/reports', 'other', 'POST', { participantId, reason: '確認' }))
        .status,
    ).toBe(200)
    expect(d.row('SELECT participant_id, reported_work_url FROM board_reports')).toEqual({
      participant_id: participantId,
      reported_work_url: 'https://example.com/work',
    })
    expect(
      (
        await call(moderate, '/api/board/moderate', 'staff', 'POST', {
          action: 'hide_participant_link',
          participantId,
        })
      ).status,
    ).toBe(200)
    expect(
      (await (await call(participants, eventUrl(id))).json()).participants[0].workUrl,
    ).toBeNull()
    expect(
      await (await call(share, shareUrl, undefined, 'GET', undefined, id)).text(),
    ).not.toContain('https://example.com/work')
    d.exec("UPDATE board_profiles SET banned_until = 9999999999999 WHERE user_id = 'reader'")
    expect(
      (
        await call(participate, joinUrl(id), 'reader', 'PUT', {
          workUrl: 'https://example.com/other',
        })
      ).status,
    ).toBe(403)
    expect((await call(participate, joinUrl(id), 'reader', 'PUT', { workUrl: null })).status).toBe(
      200,
    )
    await markProfileDeleted(d.db, 'reader', NOW)
    expect((await (await call(detail, threadUrl(id))).json()).event.participantCount).toBe(0)
    await hideThread(d.db, id, NOW)
    const hidden = await call(share, shareUrl, undefined, 'GET', undefined, id)
    expect(hidden.status).toBe(404)
    expect(await hidden.text()).not.toContain('週末')
    expect((await call(participants, eventUrl(id))).status).toBe(404)
    expect((await call(detail, threadUrl(id))).status).toBe(404)
    expect((await call(clerkWebhook, '/api/webhooks/clerk', undefined, 'POST', {})).status).toBe(
      503,
    )
  })
})

it('署名済み Clerk 退会 webhook がアカウントの通知・公開参加を片付ける', async () => {
  const threadId = await publish()
  await summary()
  await call(participate, joinUrl(threadId), 'reader', 'PUT', {})
  const key = Buffer.from('local-test-clerk-signature')
  const timestamp = String(Math.floor(NOW / 1000))
  const payload = JSON.stringify({ type: 'user.deleted', data: { id: 'reader' } })
  const signature = createHmac('sha256', key)
    .update('msg_leaf.' + timestamp + '.' + payload)
    .digest('base64')
  const webhook = (sig: string) =>
    clerkWebhook({
      env: { ...env, CLERK_WEBHOOK_SECRET: 'whsec_' + key.toString('base64') },
      request: new Request('https://local.test/api/webhooks/clerk', {
        method: 'POST',
        body: payload,
        headers: {
          'svix-id': 'msg_leaf',
          'svix-timestamp': timestamp,
          'svix-signature': 'v1,' + sig,
        },
      }),
    } as Parameters<typeof clerkWebhook>[0])
  expect((await webhook('invalid')).status).toBe(400)
  expect((await (await call(detail, threadUrl(threadId))).json()).event.participantCount).toBe(1)
  expect((await webhook(signature)).status).toBe(204)
  expect((await (await call(detail, threadUrl(threadId))).json()).event.participantCount).toBe(0)
  expect(d.row("SELECT scope FROM board_notification_state WHERE user_id = 'reader'")).toBeNull()
  expect(d.row("SELECT deleted_at FROM board_profiles WHERE user_id = 'reader'")).toEqual({
    deleted_at: NOW,
  })
})
