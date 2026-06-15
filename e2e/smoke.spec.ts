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
  await expect(page.getByRole('button', { name: '第一話', exact: true })).toBeVisible()

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

test('作品メタ（著者・あらすじ）を編集 → カードに反映され再読込でも残る', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('メタ作品')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  // ライブラリへ戻り、カードの「情報を編集」からメタを入力
  await page.goto('/')
  await page.getByRole('button', { name: '情報を編集' }).click()
  await page.getByLabel('著者').fill('山田太郎')
  await page.getByLabel('あらすじ').fill('冒険の物語')
  await page.getByRole('button', { name: '保存' }).click()

  // カードに著者が反映され、再読込しても永続している
  await expect(page.getByText('著者: 山田太郎')).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('著者: 山田太郎')).toBeVisible()
})

test('話の削除 → 一覧から消える', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('削除作品')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()
  await expect(page.getByRole('button', { name: '第一話', exact: true })).toBeVisible()

  // 各話の削除ボタン → 確認ダイアログ → 削除
  await page.getByRole('button', { name: '「第一話」を削除' }).click()
  await page.getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('button', { name: '第一話', exact: true })).toHaveCount(0)
})

test('本文欄がエディタペイン幅いっぱいに広がる（折り返しが狭くならない）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('幅テスト')
  await page.getByRole('button', { name: '作成して書き始める' }).click()
  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.waitFor()
  // エディタペイン（main 直下の最初の div）の内幅
  const paneWidth = await page.evaluate(() => {
    const pane = document.querySelector('main > div')
    return pane instanceof HTMLElement ? pane.clientWidth : 0
  })
  const box = await textarea.boundingBox()
  // textarea が固有幅(~312px)に縮まず、ペイン幅の9割以上を占有する
  expect(paneWidth).toBeGreaterThan(400)
  expect(box?.width ?? 0).toBeGreaterThan(paneWidth * 0.9)
})

test('長い無改行の本文がプレビューの紙面内で折り返す（縦書き・横書きとも飛び出さない）', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('折返しテスト')
  await page.getByRole('button', { name: '作成して書き始める' }).click()
  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()

  const textarea = page.getByRole('textbox', { name: '本文' })
  await textarea.waitFor()
  await textarea.fill('a'.repeat(300))

  const paper = page.locator('.preview')
  await paper.waitFor()
  // 既定は縦書き：紙面の固定高さを超えて下へ飛び出さない（列へ折り返す）
  const v = await paper.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(v.sh).toBeLessThanOrEqual(v.ch + 2)

  // 横書きに切替：紙面幅を超えて右へ飛び出さない（行へ折り返す）
  await page.getByRole('button', { name: '横書き' }).click()
  const h = await paper.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(h.sw).toBeLessThanOrEqual(h.cw + 2)
})

test('長い無改行の本文でも履歴カードがパネル幅を超えず復元ボタンが届く', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('履歴折返し')
  await page.getByRole('button', { name: '作成して書き始める' }).click()
  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()

  await page.getByRole('textbox', { name: '本文' }).fill('a'.repeat(300))
  await expect(page.getByText('保存済み')).toBeVisible()

  await page.getByRole('button', { name: '履歴' }).click()
  const panel = page.getByText('ローカル・セーフティネット').locator('xpath=ancestor::aside')
  await panel.waitFor()
  const card = page
    .getByText('現在の版')
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")]')
  const excerpt = card.locator('p')
  // 抜粋が折り返し、横方向にはみ出さない（スクロール幅が見た目幅を超えない）
  const ex = await excerpt.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(ex.sw).toBeLessThanOrEqual(ex.cw + 2)
  // カード右端がパネル右端を超えない＝はみ出して操作不能にならない
  const panelBox = await panel.boundingBox()
  const cardBox = await card.boundingBox()
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0) + 2,
  )
})

test('狭い画面では履歴ドロワーがオーバーレイ表示で本文幅を狭めない', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('オーバーレイ')
  await page.getByRole('button', { name: '作成して書き始める' }).click()
  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()
  await page.getByRole('textbox', { name: '本文' }).waitFor()

  const paneWidth = () =>
    page.evaluate(() => {
      const pane = document.querySelector('main > div')
      return pane instanceof HTMLElement ? pane.clientWidth : 0
    })
  const before = await paneWidth()
  await page.getByRole('button', { name: '履歴' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toBeVisible()
  const after = await paneWidth()
  // オーバーレイなので本文ペイン幅は変わらない（インライン列なら ~340px 狭まる）
  expect(Math.abs(after - before)).toBeLessThan(20)
})

test('履歴ドロワーをトグルで開閉できる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('履歴作品')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  await page.getByRole('button', { name: '新しいエピソードを追加' }).click()
  await page.getByLabel('話タイトル').fill('第一話')
  await page.getByRole('button', { name: '追加' }).click()

  // 初期は履歴ドロワー非表示
  await expect(page.getByText('ローカル・セーフティネット')).toHaveCount(0)

  // 履歴トグルで開く → 閉じるボタンで閉じる
  await page.getByRole('button', { name: '履歴' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toBeVisible()
  await page.getByRole('button', { name: '履歴を閉じる' }).click()
  await expect(page.getByText('ローカル・セーフティネット')).toHaveCount(0)
})

test('サイドバーのコレクションでライブラリへ戻れる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('戻る作品')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  // エディタからコレクションでライブラリへ
  await page.getByRole('button', { name: 'コレクション' }).click()
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
})

test('作品の削除 → ライブラリから消える', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新しいプロジェクト' }).click()
  await page.getByLabel('作品タイトル').fill('消える作品')
  await page.getByRole('button', { name: '作成して書き始める' }).click()

  // ライブラリのカードから削除 → 確認 → カードが消える
  await page.goto('/')
  await expect(page.getByText('消える作品')).toBeVisible()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('消える作品')).toHaveCount(0)
})
