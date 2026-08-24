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

  await page.getByRole('button', { name: '用語集', exact: true }).click()
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

  // 用語集に用語を1件用意する
  await openNav(page)
  await page.getByRole('button', { name: '用語集', exact: true }).click()
  await page.getByRole('button', { name: '新しく登録' }).click()
  await page.getByLabel('名前').fill('アリス')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  // 作成した項目がその場で選ばれ、編集面に開く（マスター・ディテール）
  await expect(page.getByLabel('項目の編集').getByLabel('名前')).toHaveValue('アリス')

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

/**
 * 記法バーの「参照」で空枠 [[]] を置いてから書く導線。確定時に閉じ `]]` を
 * 一緒に置換しないと [[アリス]]]] になり、ref が壊れてプレビューでリンクにならない。
 * 実機で最初に踏むのがこの順序（ボタン→入力→候補）なので e2e でも通しで踏む。
 */
test('記法バーの参照で空枠を置いてから候補確定しても括弧が二重にならない', async ({ page }) => {
  await page.goto('/')
  await createWork(page, '空枠検証')
  await openWriter(page, '空枠検証')
  await addEpisode(page, '第一話')

  await openNav(page)
  await page.getByRole('button', { name: '用語集', exact: true }).click()
  await page.getByRole('button', { name: '新しく登録' }).click()
  await page.getByLabel('名前').fill('ユグドラシル')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  // 作成した項目がその場で選ばれ、編集面に開く（マスター・ディテール）
  await expect(page.getByLabel('項目の編集').getByLabel('名前')).toHaveValue('ユグドラシル')
  await openNav(page)
  await page.getByRole('button', { name: '本文を書く', exact: true }).click()

  const ta = page.getByRole('textbox', { name: '本文' })
  await ta.click()
  await page.getByRole('button', { name: '参照', exact: true }).click()
  await expect(ta).toHaveValue('[[]]')

  // 空枠の中（キャレットは [[ の直後）に打つ
  await ta.pressSequentially('ユグ')
  const suggest = page.getByRole('listbox', { name: '参照候補' })
  await expect(suggest).toBeVisible()
  await suggest.getByRole('option', { name: /ユグドラシル/ }).click()
  await expect(ta).toHaveValue('[[ユグドラシル]]')

  // 参照にルビを重ねても両方効く（記法ボタンを続けて使うと自然にこの形になる）
  await ta.fill('[[｜ユグドラシル《せかいじゅ》]]')

  await page.getByRole('button', { name: 'プレビュー', exact: true }).click()
  // 解決済みの参照として出る（未解決スタイルではない）＋ルビも乗る
  await expect(page.locator('.preview .ref')).toHaveCount(1)
  await expect(page.locator('.preview .ref--unresolved')).toHaveCount(0)
  await expect(page.locator('.preview .ref ruby rt')).toHaveText('せかいじゅ')
})

test('記法バー：フォーカス中だけ出て、選択を囲む。@サジェスト中は候補バーが優先される', async ({
  page,
}) => {
  await page.goto('/')
  await createWork(page, '記法バー検証')
  await openWriter(page, '記法バー検証')
  await addEpisode(page, '第一話')

  const bar = page.getByRole('toolbar', { name: '記法の挿入' })
  // 本文に触れていない間は画面下端を占有しない
  await expect(bar).toBeHidden()

  const ta = page.getByRole('textbox', { name: '本文' })
  await ta.click()
  await expect(bar).toBeVisible()

  await ta.fill('黄昏の街を歩いた。')
  await ta.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(0, 2)
    el.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'ルビ', exact: true }).click()
  // 親文字が漢字だけなのでパイプ無しで自動ルビになる
  await expect(ta).toHaveValue('黄昏《》の街を歩いた。')

  // 候補が出る状態を作る（候補 0 件ならサジェスト自体が開かないため用語を1件登録する）
  await openNav(page)
  await page.getByRole('button', { name: '用語集', exact: true }).click()
  await page.getByRole('button', { name: '新しく登録' }).click()
  await page.getByLabel('名前').fill('アリス')
  await page.getByRole('button', { name: '作成', exact: true }).click()
  // 作成した項目がその場で選ばれ、編集面に開く（マスター・ディテール）
  await expect(page.getByLabel('項目の編集').getByLabel('名前')).toHaveValue('アリス')
  await openNav(page)
  await page.getByRole('button', { name: '本文を書く', exact: true }).click()

  // @ で候補バーに切り替わり、記法バーは引っ込む（同じ位置なので排他）
  const ta2 = page.getByRole('textbox', { name: '本文' })
  await ta2.click()
  await expect(bar).toBeVisible()
  await ta2.pressSequentially('@アリ')
  await expect(page.getByRole('listbox', { name: '参照候補' })).toBeVisible()
  await expect(bar).toBeHidden()
})
