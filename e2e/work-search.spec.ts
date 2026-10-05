import { test } from '@playwright/test'
import { workSearchFlow } from './work-search-helpers'

test('全話検索で下書き・一致移動・1件/全件置換・キャンセル・履歴復元を保つ', async ({page}) => {
  test.setTimeout(60000)
  await workSearchFlow(page, false)
})
