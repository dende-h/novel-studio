// 記事用スクショの台本の例（2026-10 の推敲の画面とテキスト取り込みのリリース）。
// 新しいリリースでは、このファイルを作業フォルダへ写して書き換える。
//   node <台本> <出力フォルダ>
import { readFileSync } from 'node:fs'
import {
  chromium,
  enableProofreadRules,
  findingCard,
  importText,
  openPage,
  shooter,
  sideNav,
} from '../scripts/promo-lib.mjs'

const out = process.argv[2] ?? 'shots'
const STORY = readFileSync(new URL('./proofread-story.txt', import.meta.url), 'utf-8')
const browser = await chromium.launch()
const { page: p, errors } = await openPage(browser, { width: 1440, height: 900, scale: 2 })
const { shot, el, above } = shooter(p, out)
const wait = (ms = 400) => p.waitForTimeout(ms)
const card = (...t) => findingCard(p, ...t)

try {
  // テキストの取り込み（見本の作品もこれで作る）
  await importText(p, {
    text: STORY,
    title: '潮騒の町',
    episodes: 3,
    hooks: {
      preview: (dialog) => el('leaf-text-import', dialog),
      done: (dialog) => el('leaf-text-import-done', dialog),
    },
  })
  await wait(800)

  // 推敲の画面（形態素解析の準備ができるまで待つ）
  await sideNav(p, '推敲').click()
  await p.getByRole('button', { name: '確認する項目' }).waitFor()
  await enableProofreadRules(p)
  await card('ら抜き言葉', '「見れる」').waitFor({ timeout: 30000 })
  await p.getByRole('button', { name: '確認する項目' }).click() // 閉じて本文を広く見せる
  await p.getByRole('button', { name: /^指摘を選ぶ：子供/ }).first().click()
  await wait(500)
  await shot('leaf-proofread')
  await el('leaf-proofread-cards', p.locator('aside'))

  // 直す（執筆画面の「直す箇所」に出す）
  await card('閉じ括弧').getByRole('button', { name: '直す', exact: true }).click()
  await card('三点リーダー').getByRole('button', { name: '直す', exact: true }).click()

  // 表記ゆれを作品の決まりにする
  await p.getByRole('button', { name: /子ども・子供の決まりを選ぶ|子供・子どもの決まりを選ぶ/ }).first().click()
  await wait(300)
  await shot('leaf-proofread-variant', { clip: { x: 1056, y: 190, width: 384, height: 520 } })
  await p.getByRole('menuitem', { name: '子どもにそろえる' }).click()
  await wait(500)

  // 「見れる」を3回このまま → 提案（2話にまたがって数える）
  for (let i = 0; i < 2; i++) {
    await card('ら抜き言葉', '「見れる」').getByRole('button', { name: 'このまま', exact: true }).click()
    await wait(300)
  }
  await p.locator('select').filter({ hasText: '第1話' }).selectOption({ label: '第2話　灯台' })
  await card('ら抜き言葉', '「見れる」').waitFor({ timeout: 30000 })
  await card('ら抜き言葉', '「見れる」').getByRole('button', { name: 'このまま', exact: true }).click()
  await wait(500)
  await shot('leaf-proofread-suggest', { clip: { x: 1056, y: 190, width: 384, height: 360 } })
  await p.getByRole('button', { name: '指摘しない', exact: true }).click()
  await p.getByRole('button', { name: /何度も何度もをこの作品では指摘しない/ }).first().click()
  await p.getByRole('button', { name: /この作品の決まり/ }).click()
  await wait(400)
  await shot('leaf-proofread-rules', { clip: { x: 248, y: 56, width: 1192, height: 420 } })
  await p.getByRole('button', { name: /この作品の決まり/ }).click()

  // 執筆画面の「直す箇所」
  await p.locator('select').filter({ hasText: '第2話' }).selectOption({ label: '第1話　帰郷' })
  await sideNav(p, '本文を書く').click()
  await p.getByRole('button', { name: /直すと決めた箇所/ }).click()
  await wait(500)
  await shot('leaf-fix-list')
  await p.keyboard.press('Escape')

  // 分析
  await sideNav(p, '推敲').click()
  await p.getByRole('tab', { name: '分析' }).click()
  await p.getByRole('button', { name: /汐里を用語集に登録/ }).waitFor({ timeout: 30000 })
  await el('leaf-proofread-names', p.locator('aside section').first())
  await p.getByRole('button', { name: /汐里を用語集に登録/ }).click()
  await wait(600)
  const dialog = p.getByRole('dialog')
  await above('leaf-glossary-register', dialog, dialog.getByText('サムネイル画像（任意）'))
  await p.keyboard.press('Escape')
  await wait(400)
  await p.getByRole('list', { name: '副詞・形容詞・形容動詞' }).getByRole('button', { name: /ふと/ }).click()
  await wait(400)
  await shot('leaf-proofread-frequent')
  await p.getByRole('button', { name: /^〜た：/ }).click()
  await p.locator('aside > div').last().evaluate((e) => {
    e.scrollTop = e.scrollHeight
  })
  await wait(300)
  await shot('leaf-proofread-endings')
} catch (e) {
  await shot('zz-error')
  console.log('ERR', String(e).slice(0, 600))
}
console.log(JSON.stringify({ errors }))
await browser.close()
