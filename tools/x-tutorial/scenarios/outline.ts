import { addEpisode, BODY, createWork, fillBody, openWriter } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

const WORK = '月白の庭'
const FIRST = '迷い込んだ庭'
const NOTE_INPUT = `textarea[aria-label="${FIRST}に構成メモを追加"]`

export const outline: Scenario = {
  id: 'outline',
  title: 'アウトライン',
  as: 'free',
  post: [
    '【コトノハ-leaf- の使い方】アウトライン',
    '',
    '書いた話が順に並び、話ごとに構成メモを書き足せます。Tab で一段下げれば、メモを入れ子に（3段まで）。',
    '',
    '話の順番はドラッグで入れ替え。本文の話順にも、そのまま反映されます。',
    '',
    '無料のアカウント登録で使えます。',
    '',
    '#小説執筆',
  ].join('\n'),
  setup: async (page) => {
    await createWork(page, WORK)
    await openWriter(page, WORK)
    // 3 話目は後で前へ動かすので、あえて「銀の鍵」の後ろに置いておく。
    const episodes = [
      {
        title: FIRST,
        body: '　夕暮れの垣根に、子どもがひとり通れるほどの破れ目があった。\n　灯は、振り返らずにくぐった。',
      },
      { title: '銀の鍵', body: '　門の脇の敷石に、銀の鍵がひとつ落ちていた。' },
      { title: '庭守の柊', body: '' },
    ]
    for (const ep of episodes) {
      await addEpisode(page, ep.title)
      if (ep.body) await fillBody(page, ep.body)
    }
    // 最後に足した（まだ白紙の）話ではなく、書きかけの 1 話目を開いた状態から撮り始める。
    await page.getByRole('button', { name: 'アウトライン', exact: true }).click()
    await page.getByRole('button', { name: '本文へ' }).first().click()
    await page.locator(BODY).waitFor()
  },
  run: async ({ page, caption, card, typeSlow, hold }) => {
    await card({ kicker: '使い方', title: '物語の流れを、アウトラインで' }, 3000)

    await caption('サイドバーの「アウトライン」を開きます')
    await hold(1200)
    await page.getByRole('button', { name: 'アウトライン', exact: true }).click()
    await page.getByRole('heading', { name: 'アウトライン', exact: true }).waitFor()
    await hold(1000)

    await caption('書いた話が、字数や進み具合と一緒に並びます')
    await hold(3000)

    await caption('話ごとに、構成メモを書き足せます')
    await page.locator(NOTE_INPUT).click()
    await typeSlow(NOTE_INPUT, '灯が、月白の庭に迷い込む')
    await page.locator(NOTE_INPUT).press('Enter')
    await hold(500)
    await typeSlow(NOTE_INPUT, '朔が、灯を探しに来る')
    await page.locator(NOTE_INPUT).press('Enter')
    await hold(900)

    await caption('Tab で一段下げると、メモを入れ子にできます')
    await hold(600)
    await page.locator(NOTE_INPUT).press('Tab')
    await hold(700)
    await typeSlow(NOTE_INPUT, '見つかったのは、灯の片方の靴だけ')
    await page.locator(NOTE_INPUT).press('Enter')
    await hold(2200)

    await caption('話の順番は、ドラッグで入れ替えられます')
    await hold(800)
    const handles = page.getByRole('button', { name: 'ドラッグで並べ替え' })
    const from = await handles.nth(2).boundingBox()
    const to = await handles.nth(1).boundingBox()
    if (!from || !to) throw new Error('並べ替えの取っ手が見つからない')
    const x = from.x + from.width / 2
    await page.mouse.move(x, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, from.y + from.height / 2 - 8, { steps: 4 })
    await page.mouse.move(x, to.y + to.height / 2 - 6, { steps: 24 })
    await hold(300)
    await page.mouse.up()
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('button[aria-label="ドラッグで並べ替え"]')]
      return rows[1]?.parentElement?.textContent?.includes('庭守の柊') ?? false
    })
    await hold(1600)

    await caption('入れ替えた順番は、本文の話順にも反映されます')
    await hold(2800)

    await caption('「本文へ」で、その話をすぐ書き始められます')
    await hold(1000)
    // 前へ動かした「庭守の柊」（2 行目・まだ白紙）を開く。
    await page.getByRole('button', { name: '本文へ' }).nth(1).click()
    await page.locator(BODY).waitFor()
    await hold(600)
    await typeSlow(BODY, '　庭の奥から、低い咳払いが聞こえた。')
    // 自動保存が済んで「保存済み」に変わるのを見せてから締める。
    await page.getByText('保存済み').waitFor()
    await hold(1400)

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
