import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → カクヨム 記法テキスト。
 * カクヨムはルビ・傍点ともネイティブ対応のため、往復で恒等になる（degrade なし）。
 */

const KANJI_ONLY = /^[一-鿿々〆ヵヶ]+$/

export function blocksToKakuyomu(blocks: Block[]): string {
  return blocks.map(blockToKakuyomu).join('\n')
}

function blockToKakuyomu(block: Block): string {
  if (block.type === 'sceneBreak') return '＊'
  return block.inlines.map(inlineToKakuyomu).join('')
}

function inlineToKakuyomu(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return inline.text
    case 'ruby':
      // 漢字のみの親文字はパイプ省略（自動ルビ）、それ以外は明示パイプ
      return KANJI_ONLY.test(inline.base)
        ? `${inline.base}《${inline.reading}》`
        : `｜${inline.base}《${inline.reading}》`
    case 'emphasisDots':
      // カクヨムは傍点記法ネイティブ → そのまま往復
      return `《《${inline.text}》》`
  }
}
