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
  /**
   * 2〜3行の紹介文。各サイトが掲げている思想をなるべく相手の言葉のまま引く——
   * LP のキャッチコピーや description が第一、「サイトについて」・ヘルプ・規約はその次。
   * こちらで足すのは、語尾をそろえる程度と、長さに収めるための取捨にとどめる。
   */
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
      '書きたい物が読まれる小説投稿サイトです。PV だけでなく「読み応え」で評価される場所を目指しています。短編・長編を問わず投稿できます。',
    banner: 'https://kakippa.com/thumbneil.png',
  },
  // 2026-10 掲載の了承をいただいた
  {
    name: '原石航路',
    url: 'https://gensekikoro.com/',
    intro:
      'まだ知られていない物語に出会う小説投稿サイトです。PV 数だけでなく保存率や読者の反応も見て、埋もれた物語を見つけます。',
    banner: 'https://gensekikoro.com/og.jpg',
  },
  // 2026-10 掲載の了承をいただいた
  {
    name: 'ノベル工房',
    url: 'https://novel-koubou.com/',
    intro:
      '作家の権利と利益を大切にする、作家による創作プラットフォームです。物語の構想から執筆、作品の公開までを支援します。',
    banner: 'https://novel-koubou.com/novel-kobo-og.png?v=20260920',
  },
  // 2026-10 掲載の了承をいただいた
  {
    name: 'Show too Short',
    url: 'https://show-too-short.com/',
    intro:
      'ショートショートや掌編小説を、無料で読める・投稿できる小説サイトです。5,000 文字以内で完結する一話完結の作品だけを扱います。',
    banner: 'https://show-too-short.com/images/logo.png',
  },
  // 2026-10 掲載の了承をいただいた（紹介文は運営の方からいただいた文を縮めたもの）
  {
    name: 'NOVELIGHT（ノベライト）',
    url: 'https://novelight.jp/',
    intro:
      '読書や応援でステータスをゲーム感覚でレベルアップしながら、まだ知らない物語を「発掘」できる小説投稿サイトです。人気や知名度に偏らない出会いを楽しめます。',
    banner: 'https://novelight.jp/assets/ogp/novelight-card-20261022.png?home_card=20261026',
  },
]

/** カードに添えるドメイン。見た目と飛び先が同じだと分かるよう、名前の下に必ず出す。 */
export function siteHost(url: string): string {
  return new URL(url).host
}
