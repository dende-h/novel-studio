import { expect, test } from '@playwright/test'

test('入口にマイライブラリ見出しが出る', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
})

test('作品作成→執筆→ライブプレビュー→再読込で本文が永続（IndexedDB）', async ({ page }) => {
  await page.goto('/')

  // 新規プロジェクト（ダイアログ）→ エディタへ
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('作品E2E')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  // エピソード追加（ダイアログ）
  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()
  await expect(page.getByRole('button', { name: '第一話' })).toBeVisible()

  // 本文入力 → ライブプレビューが追従
  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.fill('漢字《かんじ》\n《《重要》》')
  await expect(page.locator('.preview ruby rt')).toHaveText('かんじ')
  await expect(page.locator('.preview em.dots')).toHaveText('重要')

  // 自動保存を待ち、ライブラリへ戻って執筆し直しても復元できる
  await expect(page.getByText('保存済み')).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: '執筆' }).click()
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue('漢字《かんじ》\n《《重要》》')
})
