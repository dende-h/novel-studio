import type { Block, Episode, Inline, Work } from '../schema'

/**
 * 原稿の文字数集計（純ロジック）。
 * ルビは親文字（base）を本文として数え、読み（reading）は数えない。傍点は本文長。
 * sceneBreak は 0。ライブラリの文字数表示・進捗算出に使う。
 */

const inlineLength = (i: Inline): number => {
  switch (i.type) {
    case 'text':
      return i.text.length
    case 'ruby':
      return i.base.length
    case 'emphasisDots':
      return i.text.length
    case 'ref':
      // @参照は表示・各書き出しとも名前のプレーン文字列になるので名前長で数える
      return i.name.length
  }
}

const blockLength = (b: Block): number =>
  b.type === 'paragraph' ? b.inlines.reduce((n, i) => n + inlineLength(i), 0) : 0

export const countEpisodeChars = (ep: Episode): number =>
  ep.blocks.reduce((n, b) => n + blockLength(b), 0)

export const countWorkChars = (work: Work): number =>
  work.episodes.reduce((n, ep) => n + countEpisodeChars(ep), 0)
