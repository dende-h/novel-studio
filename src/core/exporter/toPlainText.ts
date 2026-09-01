import { publicTextOf } from '../glossary'
import type { Block, Episode, GlossaryEntry, Inline, Work } from '../schema'
import { countEpisodeChars } from '../stats'

/**
 * 正本 → AI が読める / コピーできるプレーンテキスト。
 * read-only リモート MCP の `get_work` ペイロード、および無料の「AI へコピー」導線の共通土台。
 * 辞書非依存（ref は名前へ degrade）。記法マークアップ（｜《》・傍点）は持ち込まず、
 * 読者が読む素のプロダクトに近い文字列にする（AI の読解を妨げないため）。
 */

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
      // @参照はプレーン名へ degrade（exporter は辞書非依存）。
      // ルビを重ねた ref は読みも残す（[[｜言葉《ことば》]] → 言葉（ことば））。
      return inline.children ? inline.children.map(inlineToPlainText).join('') : inline.name
  }
}

function blockToPlainText(block: Block): string {
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
export function workToPlainText(work: Work, opts: { episodeId?: string } = {}): string {
  const meta = [`# ${work.title}`]
  if (work.author) meta.push(`著者: ${work.author}`)

  const sections = [meta.join('\n')]
  if (work.description) sections.push(work.description)
  // episodeId を渡すと 1 話だけ（見出しの形は全話ぶんと同じ＝AI から見て地続き）。
  const episodes =
    opts.episodeId === undefined
      ? work.episodes
      : work.episodes.filter((ep) => ep.id === opts.episodeId)
  for (const ep of episodes) {
    sections.push(`## ${ep.title}\n\n${blocksToPlainText(ep.blocks)}`)
  }
  return sections.join('\n\n')
}

/** 話 1 件の索引行（本文は含まない）。 */
export function episodeIndexLine(ep: Episode, order: number): string {
  return `${order}. ${ep.title || '無題の話'}（${countEpisodeChars(ep)}字） [episode_id: ${ep.id}]`
}

/**
 * 本文の索引（話のタイトルと字数だけ）。全文が応答の上限に収まらないときの受け皿。
 * **本文は途中で切らない**（文の途中で切れた原稿を AI が全文と誤認すると、推敲そのものが壊れる）。
 */
export function episodeIndexToPlainText(work: Work): string {
  const head = `# ${work.title}（全 ${work.episodes.length} 話）`
  if (work.episodes.length === 0) return `${head}\n（まだ話がありません）`
  return [head, ...work.episodes.map((ep, i) => episodeIndexLine(ep, i + 1))].join('\n')
}

/**
 * 用語集1項目 → 見出し＋メタ（分類/よみ/別名）＋公開情報＋作者メモ。画像・時刻は持ち込まない。
 * `withId` のときだけ見出しに entry_id を添える（MCP の更新/削除対象の指定に必要）。
 *
 * 公開情報は 1 欄（D-GLOS-PUBLIC-ONE）＝旧データの summary / body は publicTextOf で結合して出す。
 * 作者メモは公開バンドルには載らない情報なので、非公開であることが読み手（AI・作者本人）に
 * 分かる見出しを必ず添える。
 */
export function glossaryEntryToPlainText(entry: GlossaryEntry, withId = false): string {
  const meta: string[] = []
  if (entry.category) meta.push(`分類: ${entry.category}`)
  if (entry.reading) meta.push(`よみ: ${entry.reading}`)
  if (entry.aliases.length > 0) meta.push(`別名: ${entry.aliases.join(', ')}`)

  const head = [withId ? `## ${entry.name} [entry_id: ${entry.id}]` : `## ${entry.name}`]
  if (meta.length > 0) head.push(meta.join(' ・ '))

  const blocks = [head.join('\n')]
  const pub = publicTextOf(entry)
  if (pub) blocks.push(pub)
  if (entry.authorNote) blocks.push(`### 作者メモ（非公開）\n${entry.authorNote}`)
  return blocks.join('\n\n')
}

/**
 * 用語集 → AI が読める1ドキュメント。
 * read-only リモート MCP の `get_glossary` ペイロード、および「用語集も一緒にコピー」導線の共通土台。
 * 入力の並び順を保つ（並べ替えは呼び出し側の責務）。空なら空文字。
 * `withIds`（MCP 用）を立てると各エントリに entry_id を添える＝更新/削除の対象を指定できる。
 * 無料コピー導線は既定（ID 無し）のまま＝ユーザーに内部 id を見せない。
 */
export function glossaryToPlainText(
  glossary: GlossaryEntry[],
  opts: { withIds?: boolean } = {},
): string {
  if (glossary.length === 0) return ''
  return ['# 用語集', ...glossary.map((e) => glossaryEntryToPlainText(e, opts.withIds))].join(
    '\n\n',
  )
}

/**
 * 用語集 1 項目の索引行（**公開情報・作者メモの本文は含まない**）。
 * 字数は必ず `publicTextOf` 経由で数える＝旧 2 欄（summary＋body）のレコードが 0 字に化けない。
 */
export function glossaryIndexLine(entry: GlossaryEntry): string {
  const meta: string[] = []
  if (entry.category) meta.push(`分類: ${entry.category}`)
  if (entry.reading) meta.push(`よみ: ${entry.reading}`)
  if (entry.aliases.length > 0) meta.push(`別名: ${entry.aliases.join('、')}`)
  meta.push(`公開情報 ${publicTextOf(entry).length}字`)
  if (entry.authorNote) meta.push(`作者メモ ${entry.authorNote.length}字`)
  return `- ${entry.name} [entry_id: ${entry.id}] ／ ${meta.join(' ／ ')}`
}

/**
 * 用語集の索引（見出しと entry_id だけ）。中身は `get_glossary(work_id, entry_id)` で 1 件ずつ取る。
 * 並びは保存順のまま（五十音に並べ替えない＝全量出力と順序が一致し、offset が意味を保つ）。
 */
export function glossaryIndexToPlainText(entries: GlossaryEntry[]): string {
  const head = '# 用語集の索引（本文は含みません）'
  if (entries.length === 0) return `${head}\n（該当する項目はありません）`
  return [head, ...entries.map(glossaryIndexLine)].join('\n')
}
