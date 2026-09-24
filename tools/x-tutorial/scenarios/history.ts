import { addEpisode, BODY, createWork, fillBody, openWriter, selectWord } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

const FIRST_LINE = '灯は、銀の鍵を握りしめて門の前に立った。'
const BODY_V1 = `　${FIRST_LINE}\n　月白の庭は、今夜も静まりかえっている。`

/**
 * 履歴は 90 秒以内の保存を最新版へ合体する（src/ui/store/createDefaultStore.ts の
 * SNAPSHOT_MIN_INTERVAL_MS）。最初の版を保存してから実際にこれだけ待ち、動画の中の
 * 書き直しが「別の版」として積まれるようにする（時刻を細工しないので「1分前」は本当）。
 */
const SNAPSHOT_GAP_MS = 91_000

export const history: Scenario = {
  id: 'history',
  title: '自動保存と版の履歴',
  post: [
    '【コトノハ-leaf- の使い方】自動保存と版の履歴',
    '',
    '書いた原稿は、手を止めると自動で保存されます。版の履歴は、この端末の中に残ります。',
    '',
    '右上の時計のボタンから、前の版をひらけます。いまの本文との差分を確かめてから戻せて、戻す前の版も履歴に残ります。',
    '',
    '#小説執筆',
  ].join('\n'),
  setup: async (page) => {
    await createWork(page, '月白の庭')
    await openWriter(page, '月白の庭')
    await addEpisode(page, '第一話　約束')
    await fillBody(page, BODY_V1)
    await page.waitForTimeout(SNAPSHOT_GAP_MS)
  },
  run: async ({ page, caption, card, typeSlow, hold }) => {
    await card({ kicker: '使い方', title: '書き直しても、前の版に戻せる' }, 3000)

    await caption('一文を書き直してみます')
    await selectWord(page, FIRST_LINE)
    await hold(1400)
    await typeSlow(BODY, '門の前で、灯は長いこと迷っていた。', 110)

    await caption('手を止めると自動で保存。右上に「保存済み」')
    await page.getByText('保存済み').waitFor()
    await hold(2600)

    await caption('時計のボタンで、版の履歴をひらきます')
    await page.getByRole('button', { name: '履歴', exact: true }).click()
    const panel = page.getByText('ローカル・セーフティネット').locator('xpath=ancestor::aside')
    const restore = panel.getByRole('button', { name: 'この版を復元' })
    await restore.waitFor()
    await hold(2400)

    await caption('版の履歴は、この端末の中に残ります')
    await hold(2400)

    await caption('前の版を選ぶと、いまの本文との差分が出ます')
    await restore.locator('xpath=ancestor::div[contains(@class,"rounded-lg")]').hover()
    await hold(900)
    await restore.click()
    const dialog = page.getByRole('dialog', { name: 'この版を復元しますか？' })
    await dialog.waitFor()
    await hold(3200)

    await caption('「この版を復元」で、元の文に戻ります')
    await hold(1200)
    await dialog.getByRole('button', { name: 'この版を復元' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '履歴を閉じる' }).click()
    await hold(2400)

    await caption('戻す前の版も、履歴に残ります')
    await page.getByRole('button', { name: '履歴', exact: true }).click()
    // 復元のあとの自動保存で版が積まれる（復元できる版が 2 つになる）。
    await panel.getByRole('button', { name: 'この版を復元' }).nth(1).waitFor()
    await hold(2800)

    await caption('')
    await card(
      { kicker: '登録もインストールも不要', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
