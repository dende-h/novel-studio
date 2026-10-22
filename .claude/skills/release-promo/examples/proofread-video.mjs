// X 用動画の台本の例（2026-10 の推敲の画面とテキスト取り込みのリリース・1280×800・約41秒）。
// 新しいリリースでは、このファイルを作業フォルダへ写して書き換える。
//   node <台本> <録画フォルダ>   →   scripts/encode.sh <録画フォルダ>
// 構成：タイトル（2.6秒）→ 場面ごとにテロップ1本＋操作 → 終わりの画面（3.4秒）。
import { readFileSync } from 'node:fs'
import {
  chromium,
  enableProofreadRules,
  findingCard,
  importText,
  openPage,
  promo,
  sideNav,
  startRecording,
  tapper,
} from '../scripts/promo-lib.mjs'

const out = process.argv[2] ?? 'video'
const STORY = readFileSync(new URL('./proofread-story.txt', import.meta.url), 'utf-8')
const browser = await chromium.launch()
const { ctx, page: p, errors } = await openPage(browser, { width: 1280, height: 800, overlay: true })
const tap = tapper(p)
const show = promo(p)
const wait = (ms) => p.waitForTimeout(ms)
const card = (...t) => findingCard(p, ...t)

// タイトルを出してから録画を始める（読み込み中の白い画面を写さない）
let rec
await importText(p, {
  text: STORY,
  title: '潮騒の町',
  episodes: 3,
  tap,
  hooks: {
    library: async () => {
      await show.ready()
      await show.cursor(false)
      await show.card(
        '<div class="k">新しい機能</div><div class="t font-serif">推敲の画面と、<br>テキストの取り込み</div><div class="b font-serif">コトノハ-leaf-</div>',
      )
      await wait(500)
      rec = await startRecording(ctx, p, out)
      await wait(2600)
      await show.card(null)
      await show.cursor(true)
      await wait(400)
      await show.caption('.txt や貼り付けた本文を、見出しで話に分けて取り込めます')
    },
    preview: async () => wait(1700),
  },
})
await wait(1100)

await show.caption('推敲の画面で、確かめたい項目を選びます')
await tap(sideNav(p, '推敲'), 900)
await enableProofreadRules(p, tap)
await card('ら抜き言葉', '「見れる」').waitFor({ timeout: 30000 })
await wait(500)
await tap(p.getByRole('button', { name: '確認する項目' }), 900)

await show.caption('指摘ごとに、直すか、このままにするかを選べます')
await tap(p.getByRole('button', { name: /^指摘を選ぶ：子供/ }).first(), 900)
await tap(card('閉じ括弧').getByRole('button', { name: '直す', exact: true }), 600)
await tap(card('三点リーダー').getByRole('button', { name: '直す', exact: true }), 600)
await tap(card('！？の後の空白').getByRole('button', { name: 'このまま', exact: true }), 700)

await show.caption('表記ゆれは、この作品の書き方にそろえられます')
await tap(p.getByRole('button', { name: /子ども・子供の決まりを選ぶ|子供・子どもの決まりを選ぶ/ }).first(), 700)
await tap(p.getByRole('menuitem', { name: '子どもにそろえる' }), 1500)

await show.caption('よく使う言葉や、文末の偏りも見られます')
await tap(p.getByRole('tab', { name: '分析' }), 900)
await tap(p.getByRole('list', { name: '副詞・形容詞・形容動詞' }).getByRole('button', { name: /ふと/ }), 1500)
await tap(p.getByRole('button', { name: /^〜た：/ }), 1900)

await show.caption('直すと決めた箇所は、執筆画面からたどれます')
await tap(sideNav(p, '本文を書く'), 800)
await tap(p.getByRole('button', { name: /直すと決めた箇所/ }), 2200)

await show.caption(null)
await show.cursor(false)
await show.card(
  '<div class="b font-serif" style="font-size:46px">コトノハ-leaf-</div><div class="s" style="font-size:24px;color:#1f2430">登録なしで、すぐに書き始められます</div><div class="k" style="letter-spacing:.08em;font-size:22px">cotonoha-leaf.org</div><div class="s" style="font-size:16px">推敲の画面はパソコンで、無料のアカウント登録をすると使えます</div>',
)
await wait(3400)
console.log(JSON.stringify({ errors, ...(await rec.stop()) }))
await browser.close()
