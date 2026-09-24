import type { Page } from '@playwright/test'
import { createWork, openWriter } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

const WORK = '月白の庭'

/** 中心ノード（入力欄の placeholder は、テーマを書いたあとも残る）。 */
const rootNode = (page: Page) =>
  page.locator('.react-flow__node', { has: page.locator('input[placeholder="中心のテーマ"]') })

/** ノードがちょうど n 個になるまで待つ（Enter・＋で枝が生えたか）。 */
const waitNodes = (page: Page, n: number) =>
  page.waitForFunction((k) => document.querySelectorAll('.react-flow__node').length === k, n)

/**
 * まだ何も書いていない枝のうち、いちばん上のものをクリックして入力する。
 * 生やした直後の枝には入力が移らない（アプリの現状）ので、動画でもクリックしてから書く。
 */
async function clickFirstEmpty(page: Page) {
  const inputs = page.locator('.react-flow__node input')
  let best: { i: number; y: number } | undefined
  for (let i = 0; i < (await inputs.count()); i++) {
    if ((await inputs.nth(i).inputValue()) !== '') continue
    const box = await inputs.nth(i).boundingBox()
    if (box && (!best || box.y < best.y)) best = { i, y: box.y }
  }
  if (!best) throw new Error('空の枝が無い')
  await inputs.nth(best.i).click()
}

/** ラベル（入力欄の値）でノードの入力欄を探してクリックする。 */
async function clickNode(page: Page, label: string) {
  const inputs = page.locator('.react-flow__node input')
  const n = await inputs.count()
  for (let i = 0; i < n; i++) {
    if ((await inputs.nth(i).inputValue()) === label) {
      await inputs.nth(i).click()
      return
    }
  }
  throw new Error(`ノード「${label}」が見つからない`)
}

const type = (page: Page, text: string) => page.keyboard.type(text, { delay: 130 })

export const mindmap: Scenario = {
  id: 'mindmap',
  title: 'マインドマップ',
  as: 'free',
  post: [
    '【コトノハ-leaf- の使い方】マインドマップ',
    '',
    '中心にテーマを書いて Enter を押すと、枝がのびます。枝は中心の左右どちらへも広げられ、書き足すたびに並びが自動で整います。',
    '',
    'ネタ帳のメモを、枝として取り込むこともできます。無料のアカウント登録で使えます。',
    '',
    '#小説執筆',
  ].join('\n'),
  // 作品を作ってマインドマップを開き、枝が右へ伸びても収まるよう中心を左寄せにしておく（動画に映らない）。
  setup: async (page) => {
    await createWork(page, WORK)
    await openWriter(page, WORK)
    await page.getByRole('button', { name: 'マインドマップ', exact: true }).click()
    await rootNode(page).waitFor()
    await page.waitForTimeout(600) // 初回の fitView（中心 1 つに寄って 2 倍）が済むのを待つ
    for (let i = 0; i < 4; i++) {
      await page.locator('.react-flow__controls-zoomout').click()
      await page.waitForTimeout(150)
    }
    const pane = await page.locator('.react-flow__pane').boundingBox()
    const root = await rootNode(page).boundingBox()
    if (!pane || !root) throw new Error('マインドマップが見えない')
    const from = { x: pane.x + pane.width - 150, y: pane.y + 260 }
    const dx = pane.x + 28 - root.x
    const dy = pane.y + 145 - root.y
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 })
    await page.mouse.up()
    await page.mouse.move(pane.x + pane.width - 40, pane.y + pane.height - 40)
  },
  run: async ({ page, caption, card, hold }) => {
    await card({ kicker: '使い方', title: 'ひらめきを、枝にして広げる' }, 3000)

    await caption('中心のテーマを書きます')
    await hold(900)
    await rootNode(page).locator('input').click()
    await type(page, '月白の庭')
    await hold(1800)

    await caption('Enter で、枝がのびます')
    await hold(500)
    await page.keyboard.press('Enter')
    await waitNodes(page, 2)
    await hold(1900)

    await caption('のびた枝をクリックして、書き込みます')
    await clickFirstEmpty(page)
    await hold(400)
    await type(page, '登場人物')
    await hold(1500)

    await caption('Enter を押すたびに、その先へ枝が増えます')
    for (let n = 3; n <= 5; n++) {
      await page.keyboard.press('Enter')
      await waitNodes(page, n)
      await hold(700)
    }
    await hold(600)
    for (const name of ['灯', '朔', '柊']) {
      await clickFirstEmpty(page)
      await hold(250)
      await type(page, name)
      await hold(400)
    }
    await hold(1400)

    await caption('「＋」ボタンからも、枝を出せます')
    await rootNode(page).hover()
    await hold(1200)
    await rootNode(page).getByRole('button', { name: '右へ子ノードを追加' }).click()
    await waitNodes(page, 6)
    await hold(600)
    await clickFirstEmpty(page)
    await hold(250)
    await type(page, '銀の鍵')
    await hold(500)
    await page.keyboard.press('Enter')
    await waitNodes(page, 7)
    await hold(500)
    await clickFirstEmpty(page)
    await hold(250)
    await type(page, '誰が落とした？')
    await hold(1000)

    await caption('並びは自動で整います\n書いた内容も、自動で保存されます')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.mouse.move(1000, 300)
    await hold(3600)

    await caption('')
    await card(
      { kicker: '無料のアカウント登録で使えます', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
