import type { Block, Inline } from '../schema'
import { hamelnTag } from '../sites/hameln-notation'
import { type IllustrationReference, illustrationReferences } from '../sites/illustrations'
import { type PostingSiteId, postingProfile } from '../sites/portability'

export interface PostingOptions {
  illustrations?: 'list' | 'markers'
  pixivOriginalWork?: boolean
  plainEmphasis?: boolean
  registeredImageIds?: boolean
}

export interface PostingWarning {
  line: number
  column: number
  value: string
  reason: string
  needsReview?: boolean
}

export interface PostingResult {
  text: string
  warnings: PostingWarning[]
  illustrations: (IllustrationReference & {
    line: number
    column: number
    disposition: 'keep' | 'replace'
  })[]
  characters: number
}

const kanji = /^[\p{Script=Han}々〆ヵヶ]+$/u
const lastKanji = /[\p{Script=Han}々〆ヵヶ]$/u
const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u

export function toPostingSite(
  blocks: Block[],
  site: PostingSiteId,
  options: PostingOptions = {},
): PostingResult {
  const profile = postingProfile(site)
  const warnings: PostingWarning[] = []
  const illustrations: PostingResult['illustrations'] = []
  const text = blocks
    .map((block, index) => {
      let line = ''
      let column = 1
      const warn = (value: string, reason: string, needsReview = false, offset = 0) =>
        warnings.push({ line: index + 1, column: column + offset, value, reason, needsReview })
      const plain = (value: string) => {
        if (site === 'novelup')
          return value
            .replaceAll('《', '｜《')
            .replace(/([\p{Script=Han}々〆ヵヶA-Za-z0-9])(?=（[^（）\n]+）)/gu, '$1｜')
        if (site === 'narou')
          return value.replace(
            /([\p{Script=Han}々〆ヵヶ])(?=[（(][\p{Script=Hiragana}\p{Script=Katakana}ー]{1,10}[）)])/gu,
            '$1｜',
          )
        return profile.escape ? value.replaceAll('《', '｜《') : value
      }
      const addText = (value: string) => {
        let start = 0
        for (const ref of illustrationReferences(value)) {
          line += convertTags(value.slice(start, ref.offset), start)
          const disposition =
            (ref.site === site ||
              (ref.site === 'mitemin' &&
                options.registeredImageIds &&
                (site === 'narou' || site === 'akatsuki'))) &&
            (!ref.raw.toLowerCase().startsWith('[uploadedimage:') || options.pixivOriginalWork)
              ? 'keep'
              : 'replace'
          illustrations.push({ ...ref, line: index + 1, column: column + ref.offset, disposition })
          if (disposition === 'keep')
            line +=
              site === 'narou' || site === 'akatsuki'
                ? (ref.tag ?? ref.raw)
                    .replaceAll('＜', '<')
                    .replaceAll('＞', '>')
                    .replaceAll('｜', '|')
                : ref.raw
          else if (options.illustrations === 'markers') line += `【挿絵：${ref.name}】`
          start = ref.offset + ref.raw.length
        }
        line += convertTags(value.slice(start), start)
        column += value.length
      }
      const pixivTag =
        /\[(?:newpage|(?:b|i|chapter|jump|jumpuri):[^\]\n]+)\]|\[\[jumpuri:[^\]\n]+\]\]|<\/?(?:b|i|u|s)>|\{(?:LINK|URL)[^}\n]+\}/gi
      function convertTags(value: string, offset: number) {
        let result = ''
        let start = 0
        const tags = new RegExp(`${pixivTag.source}|${hamelnTag.source}`, 'gi')
        for (const match of value.matchAll(tags)) {
          const original = match[0]
          result += plain(value.slice(start, match.index))
          const styled = /^\[([bi]):([^\]]+)\]$/i.exec(original)
          if (site === 'pixiv' && original.startsWith('[')) result += original
          else if (site === 'hameln' && original.startsWith('《')) result += original
          else if (site === 'hameln' && styled)
            result += `《${styled[1]}》${styled[2]}《/${styled[1]}》`
          else {
            warn(
              original,
              '投稿先で装飾・区切り・リンクを設定してください',
              false,
              offset + match.index,
            )
            const label =
              /^\[(?:b|i|chapter):([^\]]+)\]$/i.exec(original)?.[1] ??
              /^\[{1,2}jumpuri:([^>]+)>/i.exec(original)?.[1]?.trim()
            if (label) result += plain(label)
            else if (/jumpuri|LINK|URL/i.test(original)) result += plain(original)
          }
          start = match.index + original.length
        }
        return result + plain(value.slice(start))
      }
      const add = (inline: Inline) => {
        switch (inline.type) {
          case 'text':
            addText(inline.text)
            return
          case 'ref':
            if (inline.children) inline.children.forEach(add)
            else addText(inline.name)
            return
          case 'emphasisDots': {
            const value = inline.text
            const after = column + value.length
            if (profile.dots === 'plain' || options.plainEmphasis) {
              warn(value, '傍点を外しました')
              line += plain(value)
            } else if (profile.dots === 'pixiv' && !/[[\]>]/.test(value)) {
              line += `[[emphasismark:${value}>﹅]]`
            } else if (profile.dots === 'ruby' && !/[｜|《》]/.test(value)) {
              line += Array.from(value, (char) => `｜${char}《・》`).join('')
            } else if (
              profile.dots === 'angle' &&
              !/[《》]/.test(value) &&
              (!profile.dotsLimit || [...value].length <= profile.dotsLimit)
            ) {
              line += `《《${value}》》`
            } else {
              warn(value, '傍点が投稿先の書式か文字数の上限に合いません。本文のみ出力します', true)
              line += plain(value)
            }
            column = after
            return
          }
          case 'ruby': {
            const { base, reading } = inline
            const after = column + base.length
            const forbidden =
              profile.ruby === 'pixiv' ? /[[\]<>]/ : profile.ruby === 'hash' ? /#|__/ : /[｜|《》]/
            const limit = (value: string, fallback?: number) =>
              profile.asciiLimit && /^[A-Za-z0-9]+$/.test(value) ? profile.asciiLimit : fallback
            const baseLimit = limit(base, profile.limits?.[0])
            const readingLimit = limit(reading, profile.limits?.[1])
            if (
              !base ||
              !reading ||
              forbidden.test(base) ||
              forbidden.test(reading) ||
              (site === 'narou' && /[&"<>]/.test(base + reading)) ||
              (baseLimit !== undefined && [...base].length > baseLimit) ||
              (readingLimit !== undefined && [...reading].length > readingLimit)
            ) {
              const original = `｜${base}《${reading}》`
              warn(
                original,
                'ルビが投稿先の書式か文字数の上限に合いません。元の記法を出力します',
                true,
              )
              line += original
            } else if (profile.ruby === 'pixiv') line += `[[rb:${base} > ${reading}]]`
            else if (profile.ruby === 'hash') line += `#${base}__${reading}__#`
            else {
              const automatic =
                profile.auto &&
                kanji.test(base) &&
                !lastKanji.test(line) &&
                (site !== 'narou' || kana.test(reading))
              line += `${(automatic ? '' : '｜') + base}《${reading}》`
            }
            column = after
          }
        }
      }
      block.inlines.forEach(add)
      return line
    })
    .join('\n')
  return { text, warnings, illustrations, characters: [...text.replaceAll('\n', '')].length }
}
