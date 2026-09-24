import type { Scenario } from '../lib/stage.ts'

const BODY = 'textarea[aria-label="本文"]'

/** 本文の textarea で、word の最初の出現を選択状態にする（記法ボタンは選択を囲む）。 */
const selectWord = async (page: import('@playwright/test').Page, word: string) => {
  await page.locator(BODY).evaluate((el, w) => {
    const ta = el as HTMLTextAreaElement
    const at = ta.value.indexOf(w)
    ta.focus()
    ta.setSelectionRange(at, at + w.length)
  }, word)
}

export const rubyDots: Scenario = {
  id: 'ruby-dots',
  title: 'ルビと傍点',
  post: [
    '【コトノハ-leaf- の使い方】ルビと傍点',
    '',
    '言葉を選んで「ルビ」を押せば、あとは読みを打つだけ。強調したいところは「傍点」で。',
    '書いたそばから、隣の縦書きプレビューに映ります。',
    '',
    'なろう・カクヨム形式の書き出しでは、各サイトの記法に合わせて変換します。',
    '',
    '#小説執筆 #カクヨム',
  ].join('\n'),
  run: async ({ page, caption, card, typeSlow, hold }) => {
    // 台本の下ごしらえ（録画の冒頭カードの裏で済ませる）。
    const opening = card({ kicker: '使い方', title: 'ルビと傍点を、ボタンひとつで' }, 3000)
    await page.getByRole('button', { name: '新しい作品' }).click()
    await page.getByLabel('作品タイトル').fill('月白の庭')
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await page.getByRole('button', { name: '「月白の庭」を執筆' }).click()
    await page.getByRole('button', { name: '新しいエピソード', exact: true }).click()
    await page.getByLabel('話タイトル').fill('第一話　約束')
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await page.locator(BODY).waitFor()
    await opening

    await caption('本文を書きます')
    await typeSlow(BODY, '　少女は月白の庭に立っていた。')
    await hold(600)

    await caption('ルビを振りたい言葉を選んで')
    await selectWord(page, '月白')
    await hold(1400)

    await caption('「ルビ」を押して、読みを打つだけ')
    await page.getByRole('button', { name: 'ルビ', exact: true }).click()
    await hold(500)
    await page.locator(BODY).pressSequentially('げっぱく', { delay: 140 })
    await hold(1800)

    await caption('隣の縦書きプレビューに、すぐ映ります')
    await hold(2600)

    await caption('強調したい言葉には「傍点」')
    await page.locator(BODY).press('End')
    await typeSlow(BODY, '\n「約束は、まだ生きている」')
    await selectWord(page, 'まだ')
    await hold(1200)
    await page.getByRole('button', { name: '傍点', exact: true }).click()
    await hold(2600)

    await caption('なろう・カクヨム形式の書き出しでは、\n各サイトの記法に合わせて変換します')
    await hold(3200)

    await caption('')
    await card(
      { kicker: '登録もインストールも不要', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
