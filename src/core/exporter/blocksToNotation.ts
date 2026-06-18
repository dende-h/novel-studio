import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → ロスレスな正本記法テキスト。
 *
 * カクヨム記法（傍点ネイティブ `《《》》`・漢字のみ親文字はパイプ省略）を踏襲しつつ、
 * @参照を `[[名前]]` で**保存**する点が `blocksToKakuyomu`（外部入稿用＝ref をプレーン名に degrade）
 * との違い。ref を含まない block では blocksToKakuyomu と出力が一致する。
 * エディタの話オープン/復元・folder 往復（外部 Claude 編集の橋）が往復で ref を失わないために使う。
 * `parseEpisodeBody` と対で blocks レベルの恒等（往復不動点）を保つ。純関数。
 */

// blocksToKakuyomu と同じく、漢字のみの親文字はパイプ省略（自動ルビ）で出す
const KANJI_ONLY = /^[一-鿿々〆ヵヶ]+$/

export function blocksToNotation(blocks: Block[]): string {
  return blocks.map(blockToNotation).join('\n')
}

function blockToNotation(block: Block): string {
  if (block.type === 'sceneBreak') return '＊'
  return block.inlines.map(inlineToNotation).join('')
}

function inlineToNotation(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return inline.text
    case 'ruby':
      return KANJI_ONLY.test(inline.base)
        ? `${inline.base}《${inline.reading}》`
        : `｜${inline.base}《${inline.reading}》`
    case 'emphasisDots':
      return `《《${inline.text}》》`
    case 'ref':
      return `[[${inline.name}]]`
  }
}

export default blocksToNotation
