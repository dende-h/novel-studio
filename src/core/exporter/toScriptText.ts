import { plainTextOfBlock } from '../game'
import { PERSON_CATEGORY } from '../glossary'
import type { Work } from '../schema'
import { classifyScriptBlock } from '../script'
import {
  DEFAULT_FRONT_MATTER,
  normalizeScriptText,
  type SheetFrontMatter,
  type SheetSource,
} from '../script/layout'

/**
 * 脚本 → 提出用テキスト（流し込み・折り返しなし）。
 *
 * PDF や原稿用紙の固定レイアウトではなく、Word などへ貼って募集要項ごとの体裁に
 * 手直しできるプレーンテキストにする。行頭の規則だけを本文に焼き込む：
 * - 柱：行頭に ○。前に空行を 1 つ（打ってあっても増やさない）。
 * - ト書き：全角空白 3 つ（打ってあってもなくても同じ）。
 * - セリフ：話者名から行頭に。2 行目以降の 1 字下げは折り返しが無いので付けない
 *   （原稿用紙のプレビューで確認できる）。
 * - 場面転換 ***：×　　×　　× を 3 字下げで。
 * - 半角は全角に、感嘆符・疑問符の後ろは 1 マス空ける（`normalizeScriptText`）。
 * 前付け（表紙・登場人物表・梗概）は見出し付きで先頭に置き、本文とは改頁記号ではなく空行 2 つで分ける。
 */

const INDENT = '　　　'
const TRANSITION = `${INDENT}×　　×　　×`

/** 本文ブロック列 → 行の配列（空行の畳み込み込み）。 */
export function scriptBlocksToLines(blocks: Parameters<typeof classifyScriptBlock>[0][]): string[] {
  const out: string[] = []
  const blank = () => {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('')
  }
  for (const block of blocks) {
    const line = classifyScriptBlock(block)
    const text = normalizeScriptText(
      plainTextOfBlock(block).replace(/^\s+/u, '').replace(/\s+$/u, ''),
    )
    switch (line.kind) {
      case 'blank':
        blank()
        break
      case 'slug':
        blank()
        out.push(text)
        break
      case 'transition':
        blank()
        out.push(TRANSITION)
        blank()
        break
      case 'dialogue':
        out.push(text)
        break
      default:
        out.push(`${INDENT}${text}`)
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

/** 作品から前付けの材料を組む（登場人物表＝用語集の「人物」、梗概＝作品情報の梗概）。 */
export function sheetSourceOf(work: Work): SheetSource {
  return {
    title: work.title,
    author: work.author,
    cast: (work.glossary ?? [])
      .filter((e) => PERSON_CATEGORY.test(e.category ?? ''))
      .map((e) => ({ name: e.name, note: e.summary })),
    synopsis: work.synopsis,
    episodes: work.episodes.map((ep) => ({ title: ep.title, blocks: ep.blocks })),
  }
}

export function scriptToText(
  source: SheetSource,
  front: SheetFrontMatter = DEFAULT_FRONT_MATTER,
): string {
  const sections: string[] = []
  if (front.cover) {
    const cover = [normalizeScriptText(source.title.trim() || '無題')]
    if (source.author?.trim()) cover.push(normalizeScriptText(source.author.trim()))
    sections.push(cover.join('\n'))
  }
  if (front.cast && source.cast && source.cast.length > 0) {
    const rows = source.cast.map((c) => {
      const name = normalizeScriptText(c.name.trim())
      const note = c.note?.trim() ? normalizeScriptText(c.note.replace(/\s+/gu, ' ').trim()) : ''
      return note ? `${name}　${note}` : name
    })
    sections.push(['登場人物表', '', ...rows].join('\n'))
  }
  if (front.synopsis && source.synopsis?.trim()) {
    const paras = source.synopsis
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map((p) => p.trim())
      .filter((p, i, arr) => p !== '' || arr[i - 1] !== '')
      .map((p) => (p === '' ? '' : `　${normalizeScriptText(p)}`))
    sections.push(['梗概', '', ...paras].join('\n'))
  }
  const multi = source.episodes.length > 1
  const body = source.episodes.map((ep, i) => {
    const lines = scriptBlocksToLines(ep.blocks)
    if (multi || ep.title.trim()) {
      return [normalizeScriptText(ep.title.trim() || `第${i + 1}話`), '', ...lines].join('\n')
    }
    return lines.join('\n')
  })
  sections.push(...body)
  return `${sections.join('\n\n\n')}\n`
}

export function workToScriptText(
  work: Work,
  front: SheetFrontMatter = DEFAULT_FRONT_MATTER,
): string {
  return scriptToText(sheetSourceOf(work), front)
}
