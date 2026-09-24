import { seedWork } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

/** 書き出す原稿（ルビと傍点を含む）。動画の最初に執筆画面で見せる。 */
const EPISODE_1 = [
  '　月白《げっぱく》の庭に迷い込んだのは、夕暮れのことだった。',
  '　灯《あかり》が振り返ると、くぐってきたはずの門は、もう霧に溶けている。',
  '「銀の鍵を持っているね」',
  '　低い声がした。花の陰に、庭守の柊《ひいらぎ》が立っていた。',
  '　朔《さく》と交わした約束は、《《まだ》》終わっていない。',
].join('\n')

const EPISODE_2 = [
  '　翌朝、灯はふたたび月白の庭の門をくぐった。',
  '　柊の姿は見えない。白い花だけが、朝露に濡れていた。',
].join('\n')

/** 形式リストのボタン（名前は「見出し＋説明」なので、見出しの前方一致で引く）。 */
const formatButton = (title: string) =>
  new RegExp(`^${title.replace(/[()]/g, '\\$&')}`)

export const exportFormats: Scenario = {
  id: 'export',
  title: '書き出し',
  post: [
    '【コトノハ-leaf- の使い方】書き出し',
    '',
    '執筆画面の「書き出し」から、形式を選んで書き出せます。縦書きの EPUB、なろう・カクヨムの投稿用テキスト、話ごとのテキストをまとめた ZIP、AI に渡すテキスト。',
    '',
    'なろう向けでは、傍点を「・」のルビに置き換えます。',
    '',
    '#小説執筆 #小説家になろう',
  ].join('\n'),
  setup: async (page) => {
    // 「AI に渡す」のコピーを成功させるため、録画用のブラウザにクリップボードの権限を渡す。
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await seedWork(page, '月白の庭', [
      { title: '第一話　約束', body: EPISODE_1 },
      { title: '第二話　銀の鍵', body: EPISODE_2 },
    ])
    await page.getByRole('button', { name: '第一話　約束', exact: true }).click()
    await page.locator('textarea[aria-label="本文"]').waitFor()
  },
  run: async ({ page, caption, card, hold }) => {
    await card({ kicker: '使い方', title: '書き出しは、形式を選ぶだけ' }, 3000)

    await caption('右上の「書き出し」から')
    const open = page.getByRole('button', { name: '書き出し', exact: true })
    await open.hover()
    await hold(1200)
    await open.click()
    await page.getByRole('heading', { name: 'プロジェクトの書き出し' }).waitFor()
    await hold(600)

    await caption('縦書きの EPUB なら、\n電子書籍リーダーでそのまま読めます')
    await hold(3400)

    await page.getByRole('button', { name: formatButton('Web投稿形式') }).click()
    await caption('「小説家になろう」「カクヨム」の\n投稿用テキストにも')
    await hold(3200)

    await page.getByRole('button', { name: 'カクヨム', exact: true }).click()
    await caption('カクヨム向けは、ルビも傍点もそのまま')
    await hold(3000)

    // 字幕の変換例は、アプリの書き出し処理そのもので作る（台本に結果を書き写さない）。
    const dots = await page.evaluate(async () => {
      const { parseEpisodeBody } = await import('/src/core/parser/parseNotation.ts')
      const { blocksToNarou } = await import('/src/core/exporter/toNarou.ts')
      return blocksToNarou(parseEpisodeBody('《《まだ》》'))
    })
    await page.getByRole('button', { name: '小説家になろう', exact: true }).click()
    await caption(`なろうには傍点の記法がないので、\n《《まだ》》 → ${dots}`)
    await hold(4200)

    await caption('話を選んで、「書き出し」を押すだけ')
    await page.locator('#export-episode').selectOption({ label: '第二話　銀の鍵' })
    await hold(3000)

    await page.getByRole('button', { name: formatButton('フォルダ(ZIP)') }).click()
    await caption('話ごとのテキストを、ZIP にまとめて')
    await hold(2800)

    await page.getByRole('button', { name: formatButton('AI に渡す') }).click()
    await caption('AI に読ませるなら、コピーしてチャットに貼るだけ')
    await hold(2400)
    await page.getByRole('button', { name: 'コピー', exact: true }).click()
    await page.getByText('コピーしました。').waitFor()
    // 完了の案内は字幕の位置に出るので、字幕を消してアプリの表示をそのまま見せる。
    await caption('')
    await hold(2200)

    await card(
      { kicker: '登録もインストールも不要', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
