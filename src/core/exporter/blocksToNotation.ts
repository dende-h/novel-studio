import { needsRubyPipe } from '../parser/parseNotation'
import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → ロスレスな正本記法テキスト。
 *
 * カクヨムに近い記法に、用語参照とリテラル文字のエスケープを加える。
 * 投稿用のルビ制限や挿絵タグの変換はここでは適用しない。
 * エディタの話オープン/復元・folder 往復（外部 Claude 編集の橋）が往復で ref を失わないために使う。
 * `parseEpisodeBody` と対で blocks レベルの恒等（往復不動点）を保つ。純関数。
 */

const endsWithKanji = /[\p{Script=Han}々〆ヵヶ]$/u

function escapeText(text: string): string {
  return text.replace(/\\(?=![\\《｜|[])|[《｜|]|\[(?=\[)/g, '\\!$&')
}

export function blocksToNotation(blocks: Block[]): string {
  return blocks.map((block) => inlinesToNotation(block.inlines)).join('\n')
}

function inlinesToNotation(inlines: Inline[]): string {
  let text = ''
  for (const inline of inlines) text += inlineToNotation(inline, endsWithKanji.test(text))
  return text
}

function inlineToNotation(inline: Inline, afterKanji = false): string {
  switch (inline.type) {
    case 'text':
      return escapeText(inline.text)
    case 'ruby':
      return !afterKanji && !needsRubyPipe(inline.base)
        ? `${inline.base}《${inline.reading}》`
        : `｜${inline.base}《${inline.reading}》`
    case 'emphasisDots':
      return `《《${inline.text}》》`
    case 'ref':
      // 装飾を重ねた ref（[[｜言葉《ことば》]]）は children を中身として書き戻す。
      // ref を外側に置く正規形で出す（`《《[[言葉]]》》` と書かれていてもこちらへ寄る）。
      return `[[${inline.children ? inlinesToNotation(inline.children) : inline.name}]]`
  }
}

export default blocksToNotation
