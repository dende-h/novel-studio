import type { Block, Inline, Work } from '../schema'

/**
 * 正本 → AI が読める / コピーできるプレーンテキスト。
 * read-only リモート MCP の `get_work` ペイロード、および無料の「AI へコピー」導線の共通土台。
 * 辞書非依存（ref は名前へ degrade）。記法マークアップ（｜《》・傍点）は持ち込まず、
 * 読者が読む素のプロダクトに近い文字列にする（AI の読解を妨げないため）。
 */

/** シーン区切りの表現（なろう書き出しと揃える）。 */
const SCENE_BREAK = '＊'

function inlineToPlainText(inline: Inline): string {
  switch (inline.type) {
    case 'text':
      return inline.text
    case 'ruby':
      // 読み（ふりがな）を全角括弧で添える＝読者体験に忠実かつ AI に発音情報を渡す
      return `${inline.base}（${inline.reading}）`
    case 'emphasisDots':
      // 傍点は視覚的強調であって本文内容ではない → 素のテキストへ
      return inline.text
    case 'ref':
      // @参照はプレーン名へ degrade（exporter は辞書非依存）
      return inline.name
  }
}

function blockToPlainText(block: Block): string {
  if (block.type === 'sceneBreak') return SCENE_BREAK
  return block.inlines.map(inlineToPlainText).join('')
}

/** block 列 → 1 話分の本文テキスト（block 区切り＝改行）。 */
export function blocksToPlainText(blocks: Block[]): string {
  return blocks.map(blockToPlainText).join('\n')
}

/**
 * Work 全体 → 1 ドキュメント。タイトル/著者/あらすじの見出し＋各話を Markdown 風の
 * 見出しで連結し、AI が構造（作品名・話境界）を把握できるようにする。
 */
export function workToPlainText(work: Work): string {
  const meta = [`# ${work.title}`]
  if (work.author) meta.push(`著者: ${work.author}`)

  const sections = [meta.join('\n')]
  if (work.description) sections.push(work.description)
  for (const ep of work.episodes) {
    sections.push(`## ${ep.title}\n\n${blocksToPlainText(ep.blocks)}`)
  }
  return sections.join('\n\n')
}
