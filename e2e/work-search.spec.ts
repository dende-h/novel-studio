import { test } from '@playwright/test'
import { protectedReferenceFlow, workSearchFlow } from './work-search-helpers'

test('全話検索で下書き・一致移動・1件/全件置換・キャンセル・履歴復元を保つ', async ({page}) => {
  test.setTimeout(60000)
  await workSearchFlow(page, false)
})

test("参照を検索・移動しながら両方の置換モードで保護する", async ({ page }) => {
  test.setTimeout(60000)
  await protectedReferenceFlow(page, false)
})
