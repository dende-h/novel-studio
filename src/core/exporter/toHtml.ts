import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → ライブプレビュー用 HTML 文字列。
 * 傍点は em.dots（CSS text-emphasis 用）、シーン区切りは hr で描画する。
 * テキスト・ルビ内はすべて HTML エスケープする。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks.map(blockToHtml).join('')
}

function blockToHtml(block: Block): string {
  if (block.type === 'sceneBreak') return '<hr class="scene-break" />'
  if (block.inlines.length === 0) return '<p class="blank"></p>'
  return `<p>${block.inlines.map(inlineToHtml).join('')}</p>`
}

function inlineToHtml(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return escapeHtml(inline.text)
    case 'ruby':
      return `<ruby>${escapeHtml(inline.base)}<rt>${escapeHtml(inline.reading)}</rt></ruby>`
    case 'emphasisDots':
      return `<em class="dots">${escapeHtml(inline.text)}</em>`
  }
}
