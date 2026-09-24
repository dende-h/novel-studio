import { addEpisode, BODY, seedWork } from '../lib/app.ts'
import type { Scenario } from '../lib/stage.ts'

/**
 * 過去の記録（何日前・その日の字数の増減）。草が空っぽだと伝わらないので、下ごしらえで
 * アプリ自身の ActivityRepository.record（保存時に呼ばれるのと同じ処理）に日付をずらして流す。
 * 直近 4 日は続けて書いた形にして、今日の分で連続執筆日数がつながるのを見せる。
 * 活動した日数は 14 日未満に抑える（14 日の節目でライブラリにバックアップの案内が出るため）。
 */
const PAST: [daysAgo: number, chars: number][] = [
  [1, 820],
  [2, 450],
  [3, 1300],
  [4, 380],
  [6, 1650],
  [8, 520],
  [9, 260],
  [12, 940],
  [15, 1720],
  [19, 310],
  [23, 680],
]

/**
 * 録画の前に書いておく第一話（これも今日の記録に入る）。今日のマスがはっきり緑になるよう、
 * 動画で書き足す分と合わせて 200 字（草の濃さが一段上がる境目）を超える長さにしてある。
 */
const EPISODE_1 = [
  '　月白の庭に迷い込んだのは、夕暮れのことだった。',
  '　灯が振り返ると、くぐってきたはずの門は、もう霧に溶けている。石畳の先には、白い花ばかりが咲いていた。',
  '「銀の鍵を持っているね」',
  '　低い声がした。花の陰に、庭守の柊が立っていた。',
  '「それは、朔という子から預かったものだろう」',
  '　灯は胸もとの鍵を握りしめた。朔と交わした約束が、指先に熱い。',
  '　柊はしばらく灯の顔を見ていたが、やがて小さくうなずいた。',
  '「ついておいで。庭の奥で、ずっと君を待っている者がいる」',
].join('\n')

export const activity: Scenario = {
  id: 'activity',
  title: '執筆の記録',
  post: [
    '【コトノハ-leaf- の使い方】執筆の記録',
    '',
    '書いた字数を、日ごとに自動で記録します。書いた日はカレンダーのマスが緑になり、多く書いた日ほど色が濃くなります。',
    '',
    '連続執筆日数と今日書いた文字数も、ひと目でわかります。記録はカード画像にして共有できます。',
    '',
    '#小説執筆',
  ].join('\n'),
  setup: async (page) => {
    await page.evaluate(async (past) => {
      const { IdbStore } = await import('/src/core/storage/idbStore.ts')
      const { ActivityRepository } = await import('/src/core/storage/activityRepository.ts')
      const repo = new ActivityRepository(new IdbStore('novel-studio'))
      const DAY = 86_400_000
      for (const [ago, chars] of past) await repo.record(chars, Date.now() - ago * DAY)
    }, PAST)
    await seedWork(page, '月白の庭', [{ title: '第一話　約束', body: EPISODE_1 }])
    await addEpisode(page, '第二話　庭の奥')
    await page.locator(BODY).focus()
  },
  run: async ({ page, caption, card, typeSlow, hold }) => {
    await card({ kicker: '使い方', title: '書いた日が、緑に積もっていく' }, 3000)

    await caption('今日も、少し書き進めます')
    await typeSlow(BODY, '　翌朝、灯はふたたび月白の庭の門をくぐった。', 100)
    await page.getByText('保存済み').waitFor()
    await hold(700)

    await caption('自動保存のたびに、今日書いた字数を記録します')
    await hold(3400)

    await caption('「執筆の記録」をひらくと')
    await page.getByRole('button', { name: 'マイライブラリ', exact: true }).first().click()
    const nav = page.getByRole('button', { name: '執筆の記録', exact: true })
    await nav.hover()
    await hold(900)
    await nav.click()
    const heading = page.getByRole('heading', { name: '執筆の記録' })
    await heading.waitFor()
    await hold(1600)

    // カレンダーが字幕に隠れないよう下へ送る。年のカレンダーは画面より横に長いので、
    // 今日のマス（枠つき）が見える位置まで横へ送る（撮る日付によって位置が変わるため）。
    await heading.evaluate((h) => {
      h.closest('.overflow-y-auto')?.scrollTo({ top: 9999, behavior: 'smooth' })
    })
    await page.locator('section .overflow-x-auto').evaluate((el) => {
      const today = el.querySelector<HTMLElement>('.ring-1')
      const x = today
        ? today.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
        : el.scrollWidth
      el.scrollTo({ left: x - el.clientWidth * 0.5, behavior: 'smooth' })
    })
    await caption('書いた日は、カレンダーのマスが緑に')
    await hold(3600)

    await caption('多く書いた日ほど、濃い緑になります')
    await hold(3200)

    await heading.evaluate((h) => {
      h.closest('.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' })
    })
    await caption('連続執筆日数と、今日書いた文字も\nひと目でわかります')
    await hold(3600)

    await caption('今日まだ書いていなくても、昨日まで\n続いていれば連続執筆日数は途切れません')
    await hold(3800)

    await caption('「画像で共有」で、記録をカード画像に')
    await page.getByRole('button', { name: '画像で共有' }).hover()
    await hold(3000)

    await caption('')
    await card(
      { kicker: '登録もインストールも不要', title: 'コトノハ-leaf-', foot: '無料の縦書き小説エディタ' },
      3000,
    )
  },
}
