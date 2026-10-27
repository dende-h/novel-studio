/**
 * 小説投稿サイトの紹介（`#/sites`）に載せるサイトの一覧。
 *
 * 載せるのは、運営の方から掲載の了承をいただいたサイトだけ。了承をとった範囲は
 * 「サイト名・URL・2行ほどの紹介文」なので、相手サイトのロゴや OGP 画像は取りに行かない
 * （画面ではサイト名の頭文字の札で代える）。外してほしいと言われたら、その行を消して配る。
 */
export interface PostingSite {
  name: string
  /** サイトのトップ（https）。並びの key も兼ねる。 */
  url: string
  /** 2行ほどの紹介文。こちらで書く（相手の OGP の説明文は使わない）。 */
  intro: string
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
  },
]

/** カードに添えるドメイン。見た目と飛び先が同じだと分かるよう、名前の下に必ず出す。 */
export function siteHost(url: string): string {
  return new URL(url).host
}
