import type { Block, Inline } from '../schema'

/**
 * 正本 block 列 → ライブプレビュー用 HTML 文字列。
 * 傍点は em.dots（CSS text-emphasis 用）で描画する。
 * テキスト・ルビ内はすべて HTML エスケープする。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

/**
 * 縦書き時に半角数字が横倒し（text-orientation: mixed の既定挙動）になるのを防ぐため、
 * 1〜2 桁の連続半角数字を縦中横（CSS text-combine-upright）用の span で包む。
 * 3 桁以上はそのまま（縦中横で 1 マスに潰すと読めないため、漢数字推奨という組版慣習に従う）。
 * 入力は HTML エスケープ済み文字列を渡すこと（数字は実体参照に含まれないため順序は安全）。
 */
export function wrapTcy(escaped: string): string {
  return escaped.replace(/\d+/g, (run) =>
    run.length <= 2 ? `<span class="tcy">${run}</span>` : run,
  )
}

/**
 * @param resolvedNames 解決済み @参照名の集合。
 *   - 指定あり（プレビュー）: ref を `<span class="ref">`（解決）/ `ref ref--unresolved`（未解決）で描画。
 *   - 未指定（EPUB 等）: ref は名前のプレーンテキストへ degrade（リンク化しない）。辞書非依存を保つ。
 */
export function blocksToHtml(blocks: Block[], resolvedNames?: Set<string>): string {
  return blocks.map((b) => blockToHtml(b, resolvedNames)).join('')
}

/** inline 列だけを HTML 化する（マークダウンプレビュー等、段落を自前で組む呼び出し側用）。 */
export function inlinesToHtml(inlines: Inline[], resolvedNames?: Set<string>): string {
  return inlines.map((inl) => inlineToHtml(inl, resolvedNames)).join('')
}

function blockToHtml(block: Block, resolvedNames?: Set<string>): string {
  if (block.inlines.length === 0) return '<p class="blank"></p>'
  return `<p>${block.inlines.map((inl) => inlineToHtml(inl, resolvedNames)).join('')}</p>`
}

function inlineToHtml(inline: Inline, resolvedNames?: Set<string>): string {
  switch (inline.type) {
    case 'text':
      return wrapTcy(escapeHtml(inline.text))
    case 'ruby':
      // <rp> は ruby 対応環境では非表示になり、非対応環境では「漢字（かんじ）」と読める保険。
      return `<ruby>${escapeHtml(inline.base)}<rp>（</rp><rt>${escapeHtml(inline.reading)}</rt><rp>）</rp></ruby>`
    case 'emphasisDots':
      return `<em class="dots">${wrapTcy(escapeHtml(inline.text))}</em>`
    case 'ref': {
      // 装飾を重ねた ref（[[｜言葉《ことば》]]）は children をそのまま描く＝
      // ルビ／傍点つきのまま用語集リンクになる。children は ref を含まない（重ねは 1 段）。
      const label = inline.children
        ? inline.children.map((c) => inlineToHtml(c, resolvedNames)).join('')
        : wrapTcy(escapeHtml(inline.name))
      // プレーンモード（EPUB 等）= リンク化せずテキストノードへ
      if (!resolvedNames) return label
      const key = inline.name.trim()
      const resolved = key !== '' && resolvedNames.has(key)
      const cls = resolved ? 'ref' : 'ref ref--unresolved'
      return `<span class="${cls}" data-ref-name="${escapeAttr(inline.name)}">${label}</span>`
    }
  }
}
