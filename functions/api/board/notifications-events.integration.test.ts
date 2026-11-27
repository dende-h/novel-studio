// @vitest-environment node
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

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
import { onRequestDelete as deleteThread, onRequestGet as detail } from './thread'
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
  origin = 'https://local.test',
) {
  return await (handler as Handler)({
    env,
    params: { threadId },
    request: new Request(origin + path, {
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

  it('イベント共有ページのURLと画像はステージング内を指す', async () => {
    const id = await publish()
    const path = '/events/' + id
    const origin = 'https://stg.novel-studio-b2m.pages.dev'
    const response = await call(share, path, undefined, 'GET', undefined, id, origin)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('rel="canonical" href="' + origin + path + '"')
    expect(html).toContain('property="og:url" content="' + origin + path + '"')
    expect(html).toContain('property="og:image" content="' + origin + '/lp/ogp.png"')
  })

  it('作品リンクの通報と非表示、投稿禁止中の取り下げ、退会後の参加者除外、公開ページのカードと 404', async () => {
    const id = await publish()
    const shareUrl = '/events/' + id
    const guest = await call(share, shareUrl, undefined, 'GET', undefined, id)
    const html = await guest.text()
    expect(guest.status).toBe(200)
    expect(guest.headers.get('cache-control')).toBe('no-store')
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
    expect(hidden.headers.get('cache-control')).toBe('no-store')
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
describe('掲示板レビュー回帰', () => {
  const cancel = (id: string, user = 'host') =>
    call(patchEvent, eventUrl(id), user, 'PATCH', { action: 'cancel' })
  const deleteEvent = (id: string) => call(deleteThread, threadUrl(id), 'host', 'DELETE')
  const eventDetail = async (id: string, user: string) =>
    (await call(detail, threadUrl(id), user)).json()

  it('終了時刻に達したイベントを中止せず、過去一覧の順と参加者向け通知を保つ', async () => {
    const finished = await publish(creation({ endsAt: NOW + HOUR }))
    const older = await publish(creation({ endsAt: NOW + HOUR - 1 }))
    await call(participate, joinUrl(finished), 'reader', 'PUT', {})
    await scope('related')
    expect((await eventDetail(finished, 'host')).event.canCancel).toBe(true)
    expect((await eventDetail(finished, 'staff')).event.canCancel).toBe(true)
    const past = async () =>
      (await call(threads, '/api/board/threads?kind=event&group=past')).json()
    vi.setSystemTime(NOW + HOUR)
    expect((await past()).threads.map((row: { id: string }) => row.id)).toEqual([finished, older])
    for (const user of ['host', 'staff']) {
      expect((await eventDetail(finished, user)).event.canCancel).toBe(false)
      expect((await cancel(finished, user)).status).toBe(409)
    }
    expect((await deleteEvent(finished)).status).toBe(409)
    vi.setSystemTime(NOW + HOUR + 1)
    expect((await cancel(finished)).status).toBe(409)
    expect((await deleteEvent(finished)).status).toBe(409)
    expect((await past()).threads.map((row: { id: string }) => row.id)).toEqual([finished, older])
    expect((await eventDetail(finished, 'host')).event).toMatchObject({
      cancelledAt: null,
      revision: 1,
    })
    expect((await inbox()).notifications).toEqual([])
    expect(d.rows("SELECT id FROM board_activity WHERE kind = 'event_cancelled'")).toEqual([])
  })

  it('中止 PATCH の再送は同じ結果になり、DELETE は中止済みを 409、非公開・不存在を 404 にする', async () => {
    const id = await publish()
    await call(participate, joinUrl(id), 'reader', 'PUT', {})
    expect((await cancel(id)).status).toBe(200)
    expect((await cancel(id)).status).toBe(200)
    expect((await deleteEvent(id)).status).toBe(409)
    vi.setSystemTime(NOW + 2 * HOUR)
    expect((await cancel(id)).status).toBe(200)
    expect(d.rows("SELECT id FROM board_activity WHERE kind = 'event_cancelled'")).toHaveLength(1)
    await hideThread(d.db, id, NOW)
    expect((await deleteEvent(id)).status).toBe(404)
    expect((await deleteEvent('missing')).status).toBe(404)
    vi.setSystemTime(NOW + 3 * HOUR)
    const visibleThread = await publish(creation({ endsAt: Date.now() + HOUR }))
    d.exec(`UPDATE board_posts SET hidden_at = 1 WHERE thread_id = '${visibleThread}' AND seq = 1`)
    expect(await (await deleteEvent(visibleThread)).json()).toEqual({ error: 'not_found' })
  })

  it('DELETE の更新直前に公開状態が変わった場合は404を返す', async () => {
    const id = await publish()
    const prepare = d.db.prepare.bind(d.db)
    d.db.prepare = (sql) => {
      if (sql.includes('UPDATE board_events SET cancelled_at')) {
        d.exec(`UPDATE board_threads SET hidden_at = 1 WHERE id = '${id}'`)
      }
      return prepare(sql)
    }
    const result = await deleteEvent(id)
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: 'not_found' })
    expect(d.rows("SELECT id FROM board_activity WHERE kind = 'event_cancelled'")).toEqual([])
  })

  it('過去の開始と開催中の開始変更は400、開始を保持した編集は成功し、古いリビジョンは409', async () => {
    const start = NOW + 30 * 60_000 + 1275
    const end = NOW + HOUR
    const id = await publish(creation({ startsAt: start, endsAt: end }))
    const edit = (startsAt: number, revision = 1) =>
      call(patchEvent, eventUrl(id), 'host', 'PATCH', {
        action: 'edit',
        startsAt,
        endsAt: NOW + 2 * HOUR,
        title: '編集した題',
        body: '編集した説明',
        revision,
      })
    expect(await (await edit(NOW - 1)).json()).toEqual({ error: 'bad_event_dates' })
    const newPast = await call(
      create,
      '/api/board/threads',
      'host',
      'POST',
      creation({ startsAt: NOW - 1 }),
    )
    expect(newPast.status).toBe(400)
    expect(await newPast.json()).toEqual({ error: 'bad_event_dates' })
    vi.setSystemTime(start)
    const changedAfterStart = await edit(start + 1)
    expect(changedAfterStart.status).toBe(400)
    expect(await changedAfterStart.json()).toEqual({ error: 'bad_event_dates' })
    expect((await edit(start)).status).toBe(200)
    const edited = await eventDetail(id, 'host')
    expect(edited.event).toMatchObject({ startsAt: start, endsAt: NOW + 2 * HOUR, revision: 2 })
    expect(edited.thread.title).toBe('編集した題')
    expect(edited.posts[0].body).toBe('編集した説明')
    const conflict = await edit(start)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'event_changed' })
  })

  it('post=1 は先頭側の50返信を返し、ページ外の新着は未読のままにする', async () => {
    await summary()
    seededThread('head-page')
    for (let seq = 2; seq <= 64; seq++) seededPost('head-page', seq, 'other')
    const first = await (await call(detail, threadUrl('head-page', 1), 'reader')).json()
    expect(first.posts.map((row: { seq: number }) => row.seq)).toEqual(
      Array.from({ length: 51 }, (_, i) => i + 1),
    )
    expect(first.olderPost).toBeUndefined()
    expect(first.newerPost).toBe(64)
    expect((await readToken(first.readToken)).status).toBe(200)
    expect((await inbox()).notifications).toMatchObject([{ postSeq: 64, unread: true }])
  })

  it.each([
    'hidden_at',
    'deleted_at',
  ])('イベント本文の %s が立つと返信と通知行を作らない', async (column) => {
    const id = await publish()
    d.exec(`UPDATE board_posts SET ${column} = 1 WHERE thread_id = '${id}' AND seq = 1`)
    const result = await call(createReply, '/api/board/posts?thread=' + id, 'reader', 'POST', {
      body: '返信',
    })
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: 'not_found' })
    const noProfile = await call(
      createReply,
      '/api/board/posts?thread=' + id,
      'without-profile',
      'POST',
      { body: '返信' },
    )
    expect(noProfile.status).toBe(404)
    expect(d.rows('SELECT seq FROM board_posts WHERE thread_id = ?', id)).toEqual([{ seq: 1 }])
    expect(
      d.rows("SELECT id FROM board_activity WHERE thread_id = ? AND kind = 'reply'", id),
    ).toEqual([])
    seededThread('ordinary')
    d.exec("UPDATE board_posts SET hidden_at = 1 WHERE thread_id = 'ordinary' AND seq = 1")
    const normal = await call(createReply, '/api/board/posts?thread=ordinary', 'reader', 'POST', {
      body: '通常の返信',
    })
    expect(normal.status).toBe(201)
  })

  it('公開確認の後、保存の直前にイベント本文が伏せられても投稿・通知・スレ更新を行わない', async () => {
    const id = await publish()
    vi.setSystemTime(NOW + 3000)
    const batch = d.db.batch.bind(d.db)
    d.db.batch = (statements) => {
      const sql = statements[0] as D1PreparedStatement & { __sql: string }
      if (sql.__sql.includes('INSERT INTO board_posts')) {
        d.exec(`UPDATE board_posts SET hidden_at = 1 WHERE thread_id = '${id}' AND seq = 1`)
      }
      return batch(statements)
    }
    const result = await call(createReply, '/api/board/posts?thread=' + id, 'reader', 'POST', {
      body: '同時に送信',
    })
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: 'not_found' })
    expect(d.row('SELECT bumped_at, reply_count FROM board_threads WHERE id = ?', id)).toEqual({
      bumped_at: NOW,
      reply_count: 0,
    })
    expect(d.rows('SELECT kind FROM board_activity WHERE thread_id = ?', id)).toEqual([
      { kind: 'thread' },
    ])
  })

  it('作品URLの非表示を正規化したURL単位で保持し、削除・再参加・再送を区別する', async () => {
    const id = await publish()
    const urlA = 'https://example.com/work'
    const urlB = 'https://example.com/new'
    const update = async (workUrl: string | null) =>
      expect((await call(participate, joinUrl(id), 'reader', 'PUT', { workUrl })).status).toBe(200)
    const mine = async () => (await eventDetail(id, 'reader')).event.myParticipation
    const publicList = async () =>
      (await (await call(participants, eventUrl(id))).json()).participants
    await update(urlA)
    const [{ id: participantId }] = await publicList()
    const moderateLink = async (hide: boolean) =>
      call(moderate, '/api/board/moderate', 'staff', 'POST', {
        action: hide ? 'hide_participant_link' : 'unhide_participant_link',
        participantId,
      })
    expect((await moderateLink(true)).status).toBe(200)
    await update('https://EXAMPLE.com:443/work')
    expect(await mine()).toEqual({ workUrl: urlA, linkHidden: true })
    expect(await publicList()).toMatchObject([{ name: '参加者', workUrl: null }])
    await update(null)
    expect(await mine()).toEqual({ workUrl: null })
    await update(urlB)
    expect(await mine()).toEqual({ workUrl: urlB, linkHidden: false })
    expect(await publicList()).toMatchObject([{ workUrl: urlB }])
    await call(leave, joinUrl(id), 'reader', 'DELETE')
    expect(await mine()).toBeNull()
    await update(urlB)
    expect(await mine()).toEqual({ workUrl: urlB, linkHidden: false })
    await update(urlA)
    expect(await mine()).toEqual({ workUrl: urlA, linkHidden: true })
    expect((await moderateLink(false)).status).toBe(200)
    expect(await mine()).toEqual({ workUrl: urlA, linkHidden: false })
  })

  it('通知設定と停止・再開は認証済みの掲示板操作枠を共有する', async () => {
    expect(
      (await call(settings, notificationsPath + '/settings', undefined, 'PUT', { scope: 'off' }))
        .status,
    ).toBe(401)
    expect((await call(silence, notificationsPath + '/silent', undefined, 'PUT')).status).toBe(401)
    d.insert('rate_limits', {
      user_id: 'board:reader',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: 59,
    })
    expect((await scope('related')).status).toBe(200)
    expect((await call(silence, notificationsPath + '/silent', 'reader', 'PUT')).status).toBe(429)
    expect((await call(resume, notificationsPath + '/silent', 'reader', 'DELETE')).status).toBe(429)
    expect((await scope('off')).status).toBe(429)
    expect(await summary()).toMatchObject({ scope: 'related', silentUntil: null })
    vi.setSystemTime(NOW + 60_000)
    expect((await call(silence, notificationsPath + '/silent', 'reader', 'PUT')).status).toBe(200)
    expect((await call(resume, notificationsPath + '/silent', 'reader', 'DELETE')).status).toBe(200)
  })
})

it('0017 は従来の非表示URLと通報を保持し、切り替え前の旧コードからの操作も引き継ぐ', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const apply = (file: string) =>
      db.exec(readFileSync(new URL('../../../migrations/' + file, import.meta.url), 'utf8'))
    apply('0008_board.sql')
    apply('0009_board_post_likes.sql')
    apply('0016_board_notifications_events.sql')
    db.exec(`INSERT INTO board_event_participants (id, thread_id, user_id, joined_at, joined_after, work_url, link_hidden_at)
      VALUES ('old', 'event', 'a', 1, 1, 'https://example.com/old', 2),
        ('empty', 'event', 'b', 1, 1, NULL, 2),
        ('public', 'event', 'c', 1, 1, 'https://example.com/public', 0);
      INSERT INTO board_reports (id, post_id, user_id, reason, created_at, participant_id, reported_work_url)
      VALUES ('r', 'head', 'reporter', '確認', 1, 'old', 'https://example.com/old')`)
    apply('0017_board_event_link_moderation.sql')
    const hidden = () =>
      db
        .prepare(
          'SELECT participant_id, work_url, hidden_at FROM board_event_hidden_links ORDER BY participant_id',
        )
        .all()
    expect(hidden()).toEqual([
      { participant_id: 'old', work_url: 'https://example.com/old', hidden_at: 2 },
    ])
    expect(db.prepare('SELECT reported_work_url FROM board_reports').get()).toEqual({
      reported_work_url: 'https://example.com/old',
    })
    db.exec("UPDATE board_event_participants SET link_hidden_at = 3 WHERE id = 'public'")
    expect(hidden()).toHaveLength(2)
    db.exec("DELETE FROM board_event_participants WHERE id = 'public'")
    expect(hidden()).toHaveLength(1)
  } finally {
    db.close()
  }
})
