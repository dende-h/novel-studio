import { test } from '@playwright/test'
import { workSearchFlow } from './work-search-helpers'

test('393pxでも全話検索から本文へ移動し置換・再読込・履歴復元ができる', async ({page}) => {
  test.setTimeout(60000)
  await page.setViewportSize({width: 393, height: 851})
  await workSearchFlow(page, true)
})
