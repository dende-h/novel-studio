import type { Page } from '@playwright/test'
import { createWork, openWriter } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

const WORK = '月白の庭'
const SUMMARY = '灯が月白の庭に迷い込み、銀の鍵を拾う'

/** ビートシートの左の列（幕とカードの一覧）を、ゆっくり top までスクロールする。 */
const scrollBeatList = (page: Page, top: number) =>
  page.getByRole('button', { name: '幕を追加' }).evaluate((el, t) => {
    el.parentElement?.scrollTo({ top: t, behavior: 'smooth' })
  }, top)

export const plot: Scenario = {
  id: 'plot',
  title: 'プロット',
  as: 'free',
  post: [
    '【コトノハ-leaf- の使い方】プロット',
    '',
    '三幕構成・起承転結・序破急などの型を選ぶと、幕とガイド付きのビートが最初から並びます。',
    '',
    '伏線は「張る」と「回収」を対にして残せます。世界観設定は作者だけの控えで、読者には公開されません。',
    '',
    '無料のアカウント登録で使えます。',
    '',
    '#小説執筆 #プロット',
  ].join('\n'),
  setup: async (page) => {
    await createWork(page, WORK)
    await openWriter(page, WORK)
    await page.getByRole('button', { name: 'プロット', exact: true }).waitFor()
  },
  run: async ({ page, caption, card, typeSlow, hold }) => {
    await card({ kicker: '使い方', title: 'プロットを、型から組み立てる' }, 3000)

    await caption('サイドバーの「プロット」を開きます')
    await hold(1200)
    await page.getByRole('button', { name: 'プロット', exact: true }).click()
    await page.getByRole('heading', { name: 'プロットを作る' }).waitFor()
    await hold(1200)

    await caption('三幕構成・起承転結・序破急などの型から選べます')
    await hold(2800)

    await caption('型を選ぶと、幕とガイド付きのビートが\n最初から用意されます')
    await page.getByRole('button', { name: /^三幕構成/ }).click()
    await page.getByRole('heading', { name: 'プロット', exact: true }).waitFor()
    await hold(2600)

    await caption('出来事を「ビート」のカードにして、幕へ並べます')
    await scrollBeatList(page, 560)
    await hold(2200)
    // 選ぶカードが字幕に隠れない高さまで戻す。
    await scrollBeatList(page, 110)
    await hold(1000)

    await caption('カードを選ぶと、右のパネルで詳しく書けます')
    await page.getByRole('button', { name: '「きっかけの事件」を選択して詳細を編集' }).click()
    await hold(1400)
    await page.getByRole('textbox', { name: 'ビートの要約' }).click()
    await typeSlow('textarea[aria-label="ビートの要約"]', SUMMARY)
    await hold(600)
    // 要約は欄を離れたときに保存される。保存がカードに映るのを待ってから次の操作へ
    // （離れると同時に状態ボタンを押すと、先の保存と行き違って要約が残らないことがある）。
    await page.getByRole('textbox', { name: 'ビートの要約' }).blur()
    await caption('書いた要約は、左のカードにも映ります')
    await page.locator('p', { hasText: SUMMARY }).waitFor()
    await hold(2400)

    await caption('状態も「検討中」から「確定」へ')
    await page.getByRole('complementary').getByRole('button', { name: '確定', exact: true }).click()
    await hold(2400)

    await caption('伏線は「張る」と「回収」を対にして残せます')
    await page.getByRole('button', { name: /^伏線・秘密/ }).click()
    await hold(900)
    await page.getByRole('textbox', { name: '伏線を追加' }).click()
    await typeSlow('input[aria-label="伏線を追加"]', '銀の鍵')
    await page.getByRole('textbox', { name: '伏線を追加' }).press('Enter')
    await hold(1000)
    await page.getByRole('combobox', { name: '張るビート' }).selectOption({ label: 'きっかけの事件' })
    await hold(1200)
    await page
      .getByRole('combobox', { name: '回収するビート' })
      .selectOption({ label: 'クライマックス' })
    await hold(700)
    await caption('回収先まで決まると「回収済」に。回収漏れが一目で分かります')
    await hold(3000)

    await caption('世界観設定は作者だけの控え。\n読者に公開されることはありません')
    await page.getByRole('button', { name: '世界観設定', exact: true }).click()
    await page.getByRole('button', { name: 'この作品の約束事' }).click()
    await hold(900)
    await page.getByRole('textbox', { name: 'この作品の約束事' }).click()
    await typeSlow('textarea[aria-label="この作品の約束事"]', '庭の門は、満月の夜にだけひらく')
    await hold(2400)

    await caption('')
    await card(
      {
        kicker: '無料のアカウント登録で使えます',
        title: 'コトノハ-leaf-',
        foot: '無料の縦書き小説エディタ',
      },
      3000,
    )
  },
}
