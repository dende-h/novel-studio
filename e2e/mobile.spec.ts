import { expect, type Page, test } from '@playwright/test'

/**
 * スマホ幅（Pixel 5 エミュレーション）の回帰。playwright.config.ts の 'mobile' プロジェクト専用。
 *
 * ここで守るのは「CSS 由来のレイアウトが狭幅で成立していること」。
 * JS 判定の振る舞い（useIsNarrow・構造ツールのリセット）は vitest 側が担当する。
 * iOS のソフトキーボード・visualViewport・エッジスワイプは原理的にエミュレータでは
 * 検証できないため、実機確認に委ねている。
 */

// 初回のみ出る FirstRunDialog は各テストで前面に出て操作を奪うため、表示済みフラグを立てて出さない。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ns-onboarded', '1')
    } catch {}
  })
})

/** サイドバーのドロワー本体（執筆の記録の年タブなど他の nav と区別するため名前で引く）。 */
const navDrawer = (page: Page) => page.getByRole('navigation', { name: 'メインメニュー' })

/** 狭幅ではサイドバーがドロワー。ナビ内の操作はまず開いてから行う。 */
const openNav = async (page: Page) => {
  // 作品カードの「『◯◯』のメニュー」と衝突するので厳密一致で絞る。
  await page.getByRole('button', { name: 'メニュー', exact: true }).click()
  await expect(navDrawer(page)).toBeVisible()
}

/** 「新しい作品」はドロワー内にあるため、開いてから押す（押下でドロワーは自動的に閉じる）。 */
const createWork = async (page: Page, title: string) => {
  await openNav(page)
  await page.getByRole('button', { name: '新しい作品', exact: true }).click()
  await page.getByLabel('作品タイトル').fill(title)
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

const openWriter = (page: Page, title: string) =>
  page.getByRole('button', { name: `「${title}」を執筆` }).click()

/** エディタで話を追加する（CTA もドロワー内）。 */
const addEpisode = async (page: Page, title: string) => {
  await openNav(page)
  await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
  await page.getByLabel('話タイトル').fill(title)
  await page.getByRole('button', { name: '追加', exact: true }).click()
}

test('スマホ幅でもライブラリに到達できる（非対応オーバーレイが出ない）', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'マイライブラリ' })).toBeVisible()
  await expect(page.getByText('スマートフォンには対応していません')).toHaveCount(0)
})

test('ドロワー：ハンバーガーで開き、スクリムのタップで閉じる', async ({ page }) => {
  await page.goto('/')
  const nav = navDrawer(page)
  // 閉状態は display:none（hidden）なので不可視。
  await expect(nav).toBeHidden()

  await openNav(page)
  await expect(nav).toBeVisible()

  // スクリムは全画面（inset-0）だが、その中心はドロワー（248px 幅）の内側に入る。
  // 実ユーザーがタップするのはドロワーの右に露出した部分なので、そこを明示して押す。
  await page
    .getByRole('button', { name: 'メニューを閉じる' })
    .click({ position: { x: 340, y: 300 } })
  await expect(nav).toBeHidden()
})

test('本文を書き、プレビュータブでルビ・傍点が反映される', async ({ page }) => {
  await page.goto('/')
  await createWork(page, 'スマホ作品')
  await openWriter(page, 'スマホ作品')

  await addEpisode(page, '第一話')

  const textarea = page.getByRole('textbox', { name: '本文' })
  await expect(textarea).toBeVisible()
  await textarea.fill('漢字《かんじ》\n《《重要》》')

  // 狭幅は本文とプレビューを同時に出さない（縦書きは画面高＝行長のため）。
  const preview = page.locator('.preview')
  await expect(preview).toBeHidden()

  await page.getByRole('button', { name: 'プレビュー', exact: true }).click()
  await expect(preview).toBeVisible()
  await expect(page.locator('.preview ruby rt')).toHaveText('かんじ')
  await expect(page.locator('.preview em.dots')).toHaveText('重要')

  // 本文タブへ戻せる
  await page.getByRole('button', { name: '本文', exact: true }).click()
  await expect(textarea).toBeVisible()
  await expect(preview).toBeHidden()
})

test('本文の実効フォントサイズが 16px 以上（iOS のフォーカス時自動ズームを防ぐ）', async ({
  page,
}) => {
  await page.goto('/')
  await createWork(page, 'ズーム検証')
  await openWriter(page, 'ズーム検証')

  await addEpisode(page, '第一話')

  const size = await page
    .getByRole('textbox', { name: '本文' })
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(size).toBeGreaterThanOrEqual(16)
})

test('ドロワーは行き先を選ぶと自動で閉じる', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '自動クローズ')
  await openWriter(page, '自動クローズ')

  const nav = navDrawer(page)
  await openNav(page)
  await expect(nav).toBeVisible()

  await page.getByRole('button', { name: '図鑑', exact: true }).click()
  await expect(nav).toBeHidden()
})

test('構造化3機能（PC専用）の入口がスマホでは出ない', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '構造ゲート')
  await openWriter(page, '構造ゲート')

  await openNav(page)
  const nav = navDrawer(page)
  await expect(nav).toBeVisible()
  for (const name of ['アウトライン', '相関図', 'マインドマップ']) {
    await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
})

test('執筆の記録・ネタ帳へドロワーから到達でき、非対応案内が出ない', async ({ page }) => {
  await page.goto('/')

  await openNav(page)
  await page.getByRole('button', { name: '執筆の記録', exact: true }).click()
  await expect(page.getByRole('heading', { name: '執筆の記録' })).toBeVisible()

  await openNav(page)
  await page.getByRole('button', { name: 'ネタ帳', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ネタ帳' })).toBeVisible()
})

test('ネタ帳：入力欄が 16px 以上で、追加したネタの削除ボタンがタッチでも見える', async ({
  page,
}) => {
  await page.goto('/#/ideas')
  const input = page.getByRole('textbox').first()
  await expect(input).toBeVisible()

  const size = await input.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(size).toBeGreaterThanOrEqual(16)

  await input.fill('スマホから思いついたネタ')
  await page.getByRole('button', { name: /追加/ }).first().click()

  // hover のないタッチ環境でも削除ボタンに到達できること（opacity-0 のままだと押せない）
  const del = page.getByRole('button', { name: 'このネタを削除' }).first()
  await expect(del).toBeVisible()
})

test('@サジェストは狭幅ではキーボード直上のバーで出る', async ({ page }) => {
  await page.goto('/')
  await createWork(page, 'サジェスト検証')
  await openWriter(page, 'サジェスト検証')
  await addEpisode(page, '第一話')

  // 図鑑に用語を1件用意する
  await openNav(page)
  await page.getByRole('button', { name: '図鑑', exact: true }).click()
  await page.getByRole('button', { name: '新しく登録' }).click()
  await page.getByLabel('名前').fill('アリス')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'アリス' })).toBeVisible()

  await openNav(page)
  await page.getByRole('button', { name: '本文を書く', exact: true }).click()

  const ta = page.getByRole('textbox', { name: '本文' })
  await ta.click()
  await ta.pressSequentially('@アリ')

  const bar = page.getByRole('listbox', { name: '参照候補' })
  await expect(bar).toBeVisible()
  await bar.getByRole('option', { name: /アリス/ }).click()
  await expect(ta).toHaveValue('[[アリス]]')
})
