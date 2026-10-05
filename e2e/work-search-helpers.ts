import { expect, type Page } from '@playwright/test'

const openNav = async (page: Page, mobile: boolean) => {
  if (mobile) await page.getByRole('button', { name: 'メニュー', exact: true }).click()
}
const addEpisode = async (page: Page, title: string, mobile: boolean) => {
  await openNav(page, mobile)
  await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
  await page.getByLabel('話タイトル').fill(title)
  await page.getByRole('button', { name: '追加', exact: true }).click()
}
const switchEpisode = async (page: Page, title: string, mobile: boolean) => {
  await openNav(page, mobile)
  await page.getByRole('button', { name: title, exact: true }).click()
}
const openSearch = async (page: Page) => {
  await page.getByRole('button', { name: '検索・置換', exact: true }).click()
  await page.getByRole('button', { name: '作品全体', exact: true }).click()
  await page.getByLabel('検索する語').fill('猫')
}

export async function workSearchFlow(page: Page, mobile: boolean) {
  await page.addInitScript(() => { localStorage.setItem('ns-onboarded', '1'); localStorage.setItem('ns-reading-size', 'large') })
  await page.goto('/')
  await openNav(page, mobile)
  await page.getByRole('button', { name: '新しい作品', exact: true }).click()
  await page.getByLabel('作品タイトル').fill('全話検索')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await page.getByRole('button', { name: '「全話検索」を執筆' }).click()
  await addEpisode(page, '第一話', mobile)
  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.fill('猫と猫')
  await expect(page.getByText('保存済み', {exact: true})).toBeVisible()
  await addEpisode(page, '第二話', mobile)
  // 折り返し・長文・フォント設定を含む行のスクロールを実ブラウザで確認する。
  await textarea.fill(`${'長い前置きの文を繰り返して折り返します。'.repeat(120)}\n猫の場面`)
  await expect(page.getByText('保存済み', {exact: true})).toBeVisible()
  await switchEpisode(page, '第一話', mobile)
  await textarea.fill('猫と猫と未保存の猫')
  await openSearch(page)
  await expect(page.getByText('4件・2話', {exact: true})).toBeVisible()
  const panelBox = await page.locator('[data-work-search-panel]').boundingBox()
  const replaceBox = await page.getByRole('button', {name: 'すべて置換', exact: true}).boundingBox()
  expect(panelBox).not.toBeNull()
  expect(replaceBox).not.toBeNull()
  const viewportHeight = page.viewportSize()?.height ?? 0
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeLessThanOrEqual(viewportHeight)
  expect((replaceBox?.y ?? 0) + (replaceBox?.height ?? 0)).toBeLessThanOrEqual(viewportHeight)
  await page.screenshot({path: mobile ? '/tmp/cot29-implemented-mobile.png' : '/tmp/cot29-implemented-desktop.png'})
  await page.getByRole('button', { name: /第二話・2行/ }).click()
  await expect(textarea).toBeFocused()
  await expect.poll(() => textarea.evaluate(el => (el as HTMLTextAreaElement).value.slice((el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd))).toBe('猫')
  const scroll = await textarea.evaluate(el => ({top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight}))
  expect(scroll.total).toBeGreaterThan(scroll.height)
  expect(scroll.top).toBeGreaterThan(0)
  expect(scroll.top + scroll.height).toBeGreaterThanOrEqual(scroll.total - 100)
  if (mobile) await openSearch(page)
  await page.getByLabel('置換後の語').fill('犬')
  await page.getByRole('button', { name: 'この1件を置換' }).last().click()
  await expect(page.getByText('3件・1話', {exact: true})).toBeVisible()
  await expect(textarea).toHaveValue(/犬の場面$/)
  await page.getByRole('button', { name: 'すべて置換', exact: true }).click()
  await expect(page.getByText('3件を置換しますか？', {exact: true})).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.getByText('3件・1話', {exact: true})).toBeVisible()
  await page.getByRole('button', { name: 'すべて置換', exact: true }).click()
  await page.getByRole('button', { name: '置換', exact: true }).click()
  await expect(page.getByText('見つかりませんでした', {exact: true})).toBeVisible()
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await switchEpisode(page, '第一話', mobile)
  await expect(textarea).toHaveValue('犬と犬と未保存の犬')
  await page.reload()
  await page.goto('/')
  await page.getByRole('button', { name: '「全話検索」を執筆' }).click()
  await switchEpisode(page, '第一話', mobile)
  await expect(page.getByRole('textbox', { name: '本文' })).toHaveValue('犬と犬と未保存の犬')
  await page.getByRole('button', { name: '履歴', exact: true }).click()
  const panel = page.getByRole('complementary')
  await panel.getByRole('button', {name: 'この版を復元'}).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', {name: 'この版を復元'}).click()
  await expect(textarea).toHaveValue('猫と猫と未保存の猫')
  await expect(page.getByText('保存済み', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '履歴を閉じる'}).click()
  await switchEpisode(page, '第二話', mobile)
  await page.getByRole('button', {name: '履歴', exact: true}).click()
  const restoreButtons = panel.getByRole('button', {name: 'この版を復元'})
  let foundCatVersion = false
  for (let i = 0; i < await restoreButtons.count(); i++) {
    await restoreButtons.nth(i).click()
    if ((await dialog.textContent())?.includes('猫の場面')) {
      foundCatVersion = true
      await dialog.getByRole('button', {name: 'この版を復元'}).click()
      break
    }
    await dialog.getByRole('button', {name: 'キャンセル', exact: true}).click()
  }
  expect(foundCatVersion).toBe(true)
  await expect(textarea).toHaveValue(/猫の場面$/)
  await expect(page.getByText('保存済み', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '履歴を閉じる'}).click()
  await openSearch(page)
  await expect(page.getByText('4件・2話', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'すべて置換', exact: true}).click()
  await expect(dialog).toContainText('「猫」を削除します')
  await dialog.getByRole('button', {name: '置換', exact: true}).click()
  await expect(page.getByText('見つかりませんでした', {exact: true})).toBeVisible()
  await expect(textarea).toHaveValue(/\nの場面$/)
}

