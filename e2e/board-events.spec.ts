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
