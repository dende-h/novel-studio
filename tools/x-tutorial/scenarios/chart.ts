import type { Locator, Page } from '@playwright/test'
import { createWork, openWriter } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

const WORK = '月白の庭'
/** 用語集に登録しておく人物（名前・読み・公開情報）。 */
const CAST = [
  { name: '灯', reading: 'あかり', about: '庭に迷い込んだ少女。' },
  { name: '朔', reading: 'さく', about: '灯の幼なじみ。' },
  { name: '柊', reading: 'ひいらぎ', about: '庭守の老人。' },
] as const
const PEOPLE = CAST.map((c) => c.name)

/** 相関図のノード（ラベルで引く）。 */
const nodeOf = (page: Page, label: string) =>
  page.locator('.react-flow__node', { hasText: label })

async function center(loc: Locator) {
  const box = await loc.boundingBox()
  if (!box) throw new Error('要素が見えない')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** 人がつまんで動かすように、ノードをドラッグで (x, y) へ運ぶ。 */
async function dragTo(page: Page, loc: Locator, x: number, y: number) {
  const from = await center(loc)
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 28 })
  await page.mouse.up()
}

/** a の接続点から b の接続点へ線を引く（t/r/b/l）。 */
async function connect(page: Page, a: string, aSide: string, b: string, bSide: string) {
  const from = await center(nodeOf(page, a).locator(`.react-flow__handle[data-handleid="${aSide}"]`))
  const to = await center(nodeOf(page, b).locator(`.react-flow__handle[data-handleid="${bSide}"]`))
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 30 })
  await page.mouse.up()
}

export const chart: Scenario = {
  id: 'chart',
  title: '相関図',
  as: 'free',
  post: [
    '【コトノハ-leaf- の使い方】相関図',
    '',
    '用語集に登録した人物を、選ぶだけで相関図に並べられます。人物どうしを線でつなげば、「幼なじみ」「師弟」といった関係も書き込めます。',
    '',
    '用語集にいない人物は「自由ノード」で置けます。無料のアカウント登録で使えます。',
    '',
    '#小説執筆',
  ].join('\n'),
  // 作品を作り、用語集に人物を 3 人登録して、用語集の画面で待つ（動画に映らない）。
  setup: async (page) => {
    await createWork(page, WORK)
    await openWriter(page, WORK)
    await page.getByRole('button', { name: '用語集', exact: true }).click()
    for (const { name, reading, about } of CAST) {
      await page.getByRole('button', { name: '新しく登録' }).click()
      await page.getByRole('dialog').getByLabel('名前').fill(name)
      await page.getByRole('dialog').getByRole('button', { name: '作成', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.getByLabel('カテゴリ', { exact: true }).selectOption('人物')
      await page.getByRole('button', { name: `「${name}」を編集` }).getByText('人物').waitFor()
      // 読みと公開情報は欄を離れたときに保存される。
      const yomi = page.getByLabel('読み（任意）')
      await yomi.fill(reading)
      await yomi.blur()
      const pub = page.getByLabel('公開情報', { exact: true })
      await pub.fill(about)
      await pub.blur()
      await page.waitForTimeout(400)
    }
  },
  run: async ({ page, caption, card, hold }) => {
    await card({ kicker: '使い方', title: '人物の関係を、一枚の図に' }, 3000)

    await caption('用語集に登録した人物を、相関図に並べます')
    await hold(2600)
    await page.getByRole('button', { name: '相関図', exact: true }).click()
    await page.getByRole('button', { name: '登場人物を追加' }).waitFor()
    await hold(1000)

    await caption('「登場人物を追加」から、用語集の人物を選ぶだけ')
    for (const name of PEOPLE) {
      await page.getByRole('button', { name: '登場人物を追加' }).click()
      const pick = page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${name}`) })
      await pick.waitFor()
      await hold(name === PEOPLE[0] ? 1400 : 600)
      await pick.click()
      await nodeOf(page, name).waitFor()
      await hold(500)
    }
    await hold(800)

    // 3 人は少しずつずれて重なって出るので、三角に並べ直す。
    await caption('ドラッグで、好きな位置へ')
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (!pane) throw new Error('相関図のキャンバスが見えない')
    const cx = pane.x + pane.width / 2
    // 右下のミニマップと下の字幕にかからないよう、少し左上に寄せる。
    await dragTo(page, nodeOf(page, '灯'), cx - 30, pane.y + 120)
    await dragTo(page, nodeOf(page, '朔'), cx - 210, pane.y + 290)
    await dragTo(page, nodeOf(page, '柊'), cx + 150, pane.y + 290)
    // ノードに乗ったままだと削除ボタン（×）が出たままになるので、何も無いところへ逃がす。
    const rest = { x: pane.x + pane.width - 60, y: pane.y + 200 }
    await page.mouse.move(rest.x, rest.y, { steps: 8 })
    await hold(900)

    await caption('人物どうしを線でつなぎ、関係を書き込みます')
    await connect(page, '灯', 'l', '朔', 't')
    const relation = page.getByRole('dialog').getByLabel('関係')
    await relation.waitFor()
    await hold(700)
    await relation.pressSequentially('幼なじみ', { delay: 140 })
    await hold(500)
    await page.getByRole('button', { name: 'つなぐ', exact: true }).click()
    await page.mouse.move(rest.x, rest.y, { steps: 8 })
    await hold(1400)

    await connect(page, '柊', 't', '灯', 'r')
    await relation.waitFor()
    await relation.pressSequentially('見守る', { delay: 140 })
    await hold(400)
    await page.getByRole('button', { name: 'つなぐ', exact: true }).click()
    await page.mouse.move(rest.x, rest.y, { steps: 8 })
    await hold(1600)

    await caption('人物ごとに、色分けもできます')
    await nodeOf(page, '灯').click()
    const rose = page.getByRole('button', { name: '色: rose' })
    await rose.hover()
    await hold(900)
    await rose.click()
    await hold(500)
    await page.locator('.react-flow__pane').click({ position: { x: pane.width - 60, y: 200 } })
    await hold(1800)

    await caption('並べた位置も関係も、自動で保存されます')
    await hold(2600)

    await caption('')
    await card(
      { kicker: '無料のアカウント登録で使えます', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
