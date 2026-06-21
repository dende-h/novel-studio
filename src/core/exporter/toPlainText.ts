import type { Block, GlossaryEntry, Inline, Work } from '../schema'

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

/** 図鑑1項目 → 見出し＋メタ（分類/よみ/別名）＋要約＋本文。画像・内部 id/時刻は持ち込まない。 */
function entryToPlainText(entry: GlossaryEntry): string {
  const meta: string[] = []
  if (entry.category) meta.push(`分類: ${entry.category}`)
  if (entry.reading) meta.push(`よみ: ${entry.reading}`)
  if (entry.aliases.length > 0) meta.push(`別名: ${entry.aliases.join(', ')}`)

  const head = [`## ${entry.name}`]
  if (meta.length > 0) head.push(meta.join(' ・ '))

  const blocks = [head.join('\n')]
  if (entry.summary) blocks.push(entry.summary)
  if (entry.body) blocks.push(entry.body)
  return blocks.join('\n\n')
}

/**
 * 図鑑（オブジェクト辞書）→ AI が読める1ドキュメント。
 * read-only リモート MCP の `get_glossary` ペイロード、および「図鑑も一緒にコピー」導線の共通土台。
 * 入力の並び順を保つ（並べ替えは呼び出し側の責務）。空なら空文字。
 */
export function glossaryToPlainText(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return ''
  return ['# 図鑑', ...glossary.map(entryToPlainText)].join('\n\n')
}
