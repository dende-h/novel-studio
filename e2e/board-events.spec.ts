import { expect, test } from '@playwright/test'

test('ゲストが掲示板からイベントを選び、JST の開催期間と返信を見る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const now = Date.now()
  const id = 'event-browser-test'
  const schedule = { startsAt: now - 60_000, endsAt: now + 3_600_000, cancelledAt: null }
  const author = { displayName: '主催者', staff: false, retired: false }
  const thread = { id, title: '週末の千字小説', kind: 'event', createdAt: now, bumpedAt: now, author, event: schedule }
  const posts = [
    { id: 'head', threadId: id, seq: 1, body: '千字程度の作品を持ち寄ります。', author, createdAt: now },
    { id: 'reply', threadId: id, seq: 2, body: 'はじめまして。', author, createdAt: now },
  ]

  await page.route('**/api/board/threads*', (route) => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill({ json: { threads: query.get('kind') === 'event' ? [thread] : [], nextCursor: null, serverNow: now } })
  })
  await page.route('**/api/board/thread?**', (route) => route.fulfill({ json: {
    thread, posts, canPost: false,
    event: { ...schedule, revision: 1, participantCount: 0, myParticipation: null,
      canParticipate: false, canEdit: false, canCancel: false, serverNow: now },
  } }))

  await page.goto('/#/board')
  await page.getByRole('button', { name: 'イベント', exact: true }).click()
  await expect(page.getByRole('link', { name: /週末の千字小説/ })).toContainText('JST')
  await page.getByRole('link', { name: /週末の千字小説/ }).click()
  await expect(page.getByRole('heading', { name: '週末の千字小説' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'イベント情報' })).toContainText('開催中')
  await expect(page.getByText('はじめまして。')).toBeVisible()
  await expect(page.getByRole('button', { name: '書き込む' })).toHaveCount(0)

  await page.goto('/#/board/' + id + '?post=2')
  await expect(page.getByText('はじめまして。').locator('xpath=ancestor::article')).toBeFocused()
})
test('同じスレッドの前後ページとページ外の返信先で、応答の到着後に対象へ移動する', async ({ page }) => {
  const id = 'event-reply-pages'
  const threadPath = '/#/board/' + id
  const now = Date.now()
  const author = { displayName: '主催者', staff: false, retired: false }
  const thread = { id, title: '返信ページ回帰', kind: 'event', createdAt: now, bumpedAt: now, author }
  const event = { startsAt: now - 1, endsAt: now + 3600000, cancelledAt: null, revision: 1,
    participantCount: 0, myParticipation: null, canParticipate: false, canEdit: false, canCancel: false, serverNow: now }
  let blocked = false
  let release!: () => void
  let delayedRequests = 0

  await page.route('**/api/board/thread?**', async (route) => {
    const target = Number(new URL(route.request().url()).searchParams.get('post'))
    if (target === 101 && blocked) {
      delayedRequests++
      await new Promise<void>((resolve) => { release = resolve })
      blocked = false
    }
    const shown = target === 2 ? 2 : target === 51 ? 51 : 101
    await route.fulfill({ json: {
      thread, event, canPost: false, olderPost: shown === 101 ? 51 : undefined, newerPost: shown < 101 ? 101 : undefined,
      posts: [
        { id: 'head', threadId: id, seq: 1, body: '本文', author, createdAt: now },
        { id: 'reply-' + shown, threadId: id, seq: shown, body: '返信 ' + shown, author, createdAt: now, replyTo: shown === 101 ? 2 : 0 },
      ],
    } })
  })
  const article = (seq: number) => page.getByText('返信 ' + seq, { exact: true }).locator('xpath=ancestor::article')

  await page.goto(threadPath + '?post=101')
  await expect(article(101)).toBeFocused()
  await page.getByRole('button', { name: '前の返信' }).click()
  await expect(article(51)).toBeFocused()
  await page.getByRole('button', { name: '次の返信' }).click()
  await expect(article(101)).toBeFocused()
  await page.getByRole('button', { name: '>>2' }).click()
  await expect(article(2)).toBeFocused()

  blocked = true
  await page.getByRole('button', { name: '次の返信' }).click()
  await expect.poll(() => delayedRequests).toBe(1)
  // A second deep link arrives while the previous page's request is still pending.
  await page.goto(threadPath + '?post=51')
  await expect(article(51)).toBeFocused()
  const lateArrival = page.waitForResponse((response) => new URL(response.url()).searchParams.get('post') === '101')
  release()
  await lateArrival
  await expect(article(101)).toHaveCount(0)
  await expect(article(51)).toBeFocused()
})
