/**
 * 小説投稿サイトの紹介（`#/sites`）に載せるサイトの一覧。
 *
 * 載せるのは、運営の方から掲載の了承をいただいたサイトだけ。外してほしいと言われたら、
 * その行を消して配る。
 *
 * バナーは各サイトが公開している OGP 画像（og:image）を、**相手のサーバから直接**表示する。
 * 複製してこちらに置かない——絵の権利は相手のサイトと絵の作者にあり、相手が差し替えたり
 * 消したりしたらそのまま従うため。読み込みは閲覧者のブラウザから相手へ届くので、
 * プライバシーポリシー（`public/privacy.html` の 4 章）に書いてある。
 */
export interface PostingSite {
  name: string
  /** サイトのトップ（https）。並びの key も兼ねる。 */
  url: string
  /** 2行ほどの紹介文。こちらで書く（相手の OGP の説明文は使わない）。 */
  intro: string
  /**
   * バナーにする og:image の URL（https）。足すときに相手のページの OGP を読んで写す。
   * 無いサイトは省き、画面ではサイト名の札で代える。
   */
  banner?: string
}

/** 紹介文の上限。ページの幅でおおむね2行に収まる長さ。 */
export const POSTING_SITE_INTRO_MAX = 80

/** 載せる順に並べる。足すときは掲載の了承をいただいた月を添える。 */
export const POSTING_SITES: readonly PostingSite[] = [
  // 2026-10 掲載の了承をいただいた
  {
    name: 'ラノベ書きっぱ！',
    url: 'https://kakippa.com/',
    intro:
      'PV だけでなく「読み応え」で評価される場所をめざす投稿サイトです。短編も長編も、王道から実験的な作品まで載せられます。',
    banner: 'https://kakippa.com/thumbneil.png',
  },
  // 2026-10 掲載の了承をいただいた
  {
    name: '原石航路',
    url: 'https://gensekikoro.com/',
    intro:
      '人気になる前の作品を、読者と一緒に見つけるライトノベル投稿サイトです。PV 数だけでなく、保存率や読者の反応からも作品を紹介します。',
    banner: 'https://gensekikoro.com/og.jpg',
  },
  // 2026-10 掲載の了承をいただいた
  {
    name: 'ノベル工房',
    url: 'https://novel-koubou.com/',
    intro:
      '設定やプロットを整理しながら書き、そのまま公開できる創作ワークスペースです。読者は本文の行ごとに「イチオシ！」を付けられます。',
    banner: 'https://novel-koubou.com/novel-kobo-og.png?v=20260920',
  },
]

/** カードに添えるドメイン。見た目と飛び先が同じだと分かるよう、名前の下に必ず出す。 */
export function siteHost(url: string): string {
  return new URL(url).host
}
