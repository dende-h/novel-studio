import { test } from '@playwright/test'
import { protectedReferenceFlow, workSearchFlow } from './work-search-helpers'

test('393pxでも全話検索から本文へ移動し置換・再読込・履歴復元ができる', async ({page}) => {
  test.setTimeout(60000)
  await page.setViewportSize({width: 393, height: 851})
  await workSearchFlow(page, true)
})

test("参照を検索・移動しながら両方の置換モードで保護する", async ({ page }) => {
  test.setTimeout(60000)
  await page.setViewportSize({ width: 393, height: 851 })
  await protectedReferenceFlow(page, true)
})
