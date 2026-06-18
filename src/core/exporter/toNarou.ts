import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → 小説家になろう 記法テキスト。
 * 記法はサイト互換なので、ルビ・行構造は往復で恒等になる（傍点を除く）。
 */

const KANJI_ONLY = /^[一-鿿々〆ヵヶ]+$/

export function blocksToNarou(blocks: Block[]): string {
  return blocks.map(blockToNarou).join('\n')
}

function blockToNarou(block: Block): string {
  if (block.type === 'sceneBreak') return '＊'
  return block.inlines.map(inlineToNarou).join('')
}

function inlineToNarou(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return inline.text
    case 'ruby':
      // 漢字のみの親文字はパイプ省略（自動ルビ）、それ以外は明示パイプ
      return KANJI_ONLY.test(inline.base)
        ? `${inline.base}《${inline.reading}》`
        : `｜${inline.base}《${inline.reading}》`
    case 'emphasisDots':
      // なろうに傍点記法は無い → 各文字にルビ「・」で degrade
      return [...inline.text].map((ch) => `｜${ch}《・》`).join('')
    case 'ref':
      // @参照記法はなろうに無い → 名前のプレーンテキストへ degrade（exporter は辞書非依存）
      return inline.name
  }
}
