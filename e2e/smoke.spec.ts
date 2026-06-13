import { expect, test } from '@playwright/test'

test('トップに novel-studio 見出しが出る', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'novel-studio' })).toBeVisible()
})

test('執筆→ライブプレビュー→再読込で本文が永続（IndexedDB）', async ({ page }) => {
  const titles = ['作品E2E', '第一話']
  page.on('dialog', (d) => d.accept(titles.shift() ?? 'x'))

  await page.goto('/')
  // 入り口（LP）から執筆画面へ
  await page.getByRole('button', { name: '書き始める' }).click()
  await page.getByRole('button', { name: '新規作品' }).click()
  await page.getByRole('button', { name: '新規話' }).click()

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.fill('漢字《かんじ》\n《《重要》》')

  // ライブプレビューが追従
  await expect(page.locator('.preview ruby rt')).toHaveText('かんじ')
  await expect(page.locator('.preview em.dots')).toHaveText('重要')

  // 自動保存を待ち、再読込しても復元できる
  await expect(page.getByText('保存済み')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '作品E2E' }).click()
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue('漢字《かんじ》\n《《重要》》')
})
