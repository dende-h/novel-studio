import { expect, type Page, test } from '@playwright/test'

// FirstRunDialog を出さない（smoke.spec.ts と同じ）。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ns-onboarded', '1')
    } catch {}
  })
})

/** 作品一覧の「データ管理」→「テキストから作品を作る」を開く。 */
const openTextImport = async (page: Page) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
  await page.getByRole('button', { name: 'データ管理' }).click()
  await page.getByRole('menuitem', { name: 'テキストから作品を作る' }).click()
  await expect(page.getByRole('dialog', { name: 'テキストから作品を作る' })).toBeVisible()
}

test('貼り付けた本文を見出しで分けて作品にし、執筆画面で本文が見える', async ({ page }) => {
  await openTextImport(page)
  const dialog = page.getByRole('dialog', { name: 'テキストから作品を作る' })

  await dialog.getByRole('button', { name: '貼り付け' }).click()
  await dialog
    .getByRole('textbox', { name: '本文', exact: true })
    .fill('第1話　出会い\n　｜吾輩《わがはい》は猫である。\n\n第2話　別れ\n　名前はまだ無い。')
  await expect(dialog.getByText('2 話に分かれます')).toBeVisible()
  await dialog.getByLabel('作品タイトル').fill('取り込みの試し')

  // モバイル幅では 2 ステップ（「次へ」を押してから作成）
  const next = dialog.getByRole('button', { name: '次へ' })
  if (await next.isVisible()) await next.click()
  await dialog.getByRole('button', { name: '作品を作る' }).click()
  await expect(dialog.getByText(/2 話で「取り込みの試し」を作りました/)).toBeVisible()

  await dialog.getByRole('button', { name: '執筆を始める' }).click()
  // 先頭の話が開き、本文は記法のまま
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue(
    '　吾輩《わがはい》は猫である。',
  )
})

test('UTF-8 の .txt を 2 つ渡すと自然順に並び、作品一覧にカードが出る', async ({ page }) => {
  await openTextImport(page)
  const dialog = page.getByRole('dialog', { name: 'テキストから作品を作る' })

  await dialog.getByLabel('テキストファイル').setInputFiles([
    { name: '10_終章.txt', mimeType: 'text/plain', buffer: Buffer.from('第3話\n三つ目', 'utf-8') },
    {
      name: '2_序章.txt',
      mimeType: 'text/plain',
      // BOM と CRLF が混ざっていても揃えて読む
      buffer: Buffer.from('﻿第1話\r\n一つ目\r\n\r\n第2話\r\n二つ目', 'utf-8'),
    },
  ])
  await expect(dialog.getByText('3 話に分かれます')).toBeVisible()
  await expect(dialog.getByLabel('作品タイトル')).toHaveValue('2_序章')
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('第1話')
  await expect(dialog.getByLabel('3話目のタイトル')).toHaveValue('第3話')

  const next = dialog.getByRole('button', { name: '次へ' })
  if (await next.isVisible()) await next.click()
  await dialog.getByRole('button', { name: '作品を作る' }).click()
  await expect(dialog.getByText(/3 話で「2_序章」を作りました/)).toBeVisible()
  await dialog.getByRole('button', { name: '閉じる' }).click()

  await expect(page.getByRole('heading', { name: '2_序章' })).toBeVisible()
})

test('Shift_JIS の .txt も文字化けせずに読める', async ({ page }) => {
  await openTextImport(page)
  const dialog = page.getByRole('dialog', { name: 'テキストから作品を作る' })
  // 「第1話\nあい」の Shift_JIS バイト列
  const sjis = Buffer.from([
    0x91, 0xe6, 0x31, 0x98, 0x62, 0x0d, 0x0a, 0x82, 0xa0, 0x82, 0xa2,
  ])
  await dialog
    .getByLabel('テキストファイル')
    .setInputFiles([{ name: 'sjis.txt', mimeType: 'text/plain', buffer: sjis }])
  await expect(dialog.getByText('Shift_JIS', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('1話目のタイトル')).toHaveValue('第1話')
  await expect(dialog.getByText('あい')).toBeVisible()
})
