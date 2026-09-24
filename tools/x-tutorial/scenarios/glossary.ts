import type { Page } from '@playwright/test'
import { addEpisode, BODY, createWork, fillBody, openWriter } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

/** 下ごしらえで登録しておく用語（候補の一覧に読みとカテゴリが並ぶように）。 */
const ENTRIES = [
  { name: '月白の庭', reading: 'げっぱくのにわ', category: '場所', summary: '街はずれにある古い庭。' },
  { name: '柊', reading: 'ひいらぎ', category: '人物', summary: '月白の庭を守る老人。' },
  { name: '朔', reading: 'さく', category: '人物', summary: '灯の幼なじみ。' },
  { name: '銀の鍵', reading: 'ぎんのかぎ', category: 'アイテム', summary: '庭の門をひらく鍵。' },
]

/** エディタの用語集パネルの「新しく登録」から、読み・カテゴリ・公開情報つきで登録する。 */
async function registerEntry(page: Page, e: (typeof ENTRIES)[number]) {
  await page.getByRole('button', { name: '新しく登録' }).click()
  const dialog = page.getByRole('dialog', { name: '用語集に登録' })
  await dialog.getByLabel('名前', { exact: true }).fill(e.name)
  await dialog.getByLabel('読み（任意）').fill(e.reading)
  await dialog.getByLabel('カテゴリ').selectOption(e.category)
  const summary = dialog.getByRole('textbox', { name: '公開情報（任意）', exact: true })
  await summary.fill(e.summary)
  // 公開情報の欄は blur で確定する。
  await summary.blur()
  await dialog.getByRole('button', { name: '作成', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

/** 本文の末尾にキャレットを置く。 */
async function caretToEnd(page: Page) {
  await page.locator(BODY).evaluate((el) => {
    const ta = el as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  })
}

export const glossary: Scenario = {
  id: 'glossary',
  title: '用語集',
  post: [
    '【コトノハ-leaf- の使い方】用語集',
    '',
    '本文で ＠ を打つと、用語集の候補がひらきます。読みでも絞り込めて、選べば本文に入ります。',
    '',
    'まだ無い名前は、その場で登録。プレビューの名前を押せば用語集がひらき、読みやカテゴリ、説明を書き足せます。',
    '',
    '#小説執筆',
  ].join('\n'),
  setup: async (page) => {
    await createWork(page, '月白の庭')
    await openWriter(page, '月白の庭')
    await addEpisode(page, '第一話　約束')
    await page.getByRole('button', { name: '用語集パネル' }).click()
    for (const e of ENTRIES) await registerEntry(page, e)
    await page.getByRole('button', { name: '用語集パネルを閉じる' }).click()
    await fillBody(page, '　[[月白の庭]]には、古い門がひとつある。')
    await caretToEnd(page)
  },
  run: async ({ page, caption, card, typeSlow, hold }) => {
    await card({ kicker: '使い方', title: '＠ひとつで、用語集を呼び出す' }, 3000)

    await caption('＠を打つと、用語集の候補がひらきます')
    await caretToEnd(page)
    await typeSlow(BODY, '\n　その夜、＠', 110)
    await page.getByRole('listbox', { name: '参照候補' }).waitFor()
    await hold(2600)

    await caption('読みでも絞り込めます。Enter で本文へ')
    await typeSlow(BODY, 'ひ', 110)
    await hold(1600)
    await page.locator(BODY).press('Enter')
    await hold(900)
    await typeSlow(BODY, 'は門の前で、', 110)
    await hold(400)

    await caption('まだ無い名前は、その場で登録できます')
    await typeSlow(BODY, '＠灯', 160)
    await page.getByRole('option', { name: '「灯」を新規作成' }).waitFor()
    await hold(2200)
    await page.locator(BODY).press('Enter')
    await typeSlow(BODY, 'を待っていた。', 110)
    await page.getByText('保存済み').waitFor()
    await hold(900)

    await caption('プレビューの名前から、用語集をひらけます')
    await hold(1200)
    await page.locator('.preview .ref[data-ref-name="灯"]').click()
    await page.getByRole('heading', { name: '灯', exact: true }).waitFor()
    await hold(2200)

    await caption('読み・カテゴリ・説明を書き足して')
    await page.getByRole('button', { name: '編集', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '用語を編集' })
    await dialog.waitFor()
    await hold(600)
    await dialog.getByLabel('読み（任意）').pressSequentially('あかり', { delay: 140 })
    await hold(300)
    await dialog.getByLabel('カテゴリ').selectOption('人物')
    await hold(500)
    const summary = dialog.getByRole('textbox', { name: '公開情報（任意）', exact: true })
    await summary.pressSequentially('月白の庭に迷い込んだ少女。朔の幼なじみ。', { delay: 70 })
    await summary.blur()
    await hold(900)
    // 字幕が「保存する」に重なるので、押す前に消して見せる。
    await caption('')
    await hold(600)
    await dialog.getByRole('button', { name: '保存する' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await hold(400)

    await caption('登場した話と回数も、ここでわかります')
    await hold(2600)

    await caption('用語集の画面で、作品の用語を一覧できます')
    await page.getByRole('button', { name: '用語集パネルを閉じる' }).click()
    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('button', { name: '用語集', exact: true })
      .click()
    await page.getByRole('heading', { name: '用語集', exact: true }).waitFor()
    await hold(1400)
    await page.getByRole('button', { name: '「灯」を編集' }).click()
    await hold(2600)

    await caption('')
    await card(
      { kicker: '登録もインストールも不要', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
