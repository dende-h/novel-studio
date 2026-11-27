import { type PostingSiteId, postingProfile } from './portability'

const han = String.raw`[\p{Script=Han}々〆ヵヶ]`
const kana = String.raw`[\p{Script=Hiragana}\p{Script=Katakana}ー]`
const rubyDots = /《《[^《》\n]+》》/g
const angleRuby = /[｜|][^｜|《》\n]+《[^《》\n]+》/g
const ambiguousHamelnEscape = /《！《[^《》\n]+》》/g

function parentheses(site: PostingSiteId): RegExp | null {
  switch (postingProfile(site).parens) {
    case 'narou':
      return new RegExp(han + '(?=（' + kana + '{1,10}）|\\(' + kana + '{1,10}\\))', 'gu')
    case 'wide':
      return /[\p{Script=Han}々〆ヵヶA-Za-z0-9](?=（[^（）\n]+）)/gu
    case 'ascii':
      return new RegExp(han + '(?=\\([^()\n]+\\))', 'gu')
    case 'akatsuki':
      return new RegExp(han + '(?=（' + kana + '+）|\\(\\(' + kana + '+\\)\\))', 'gu')
    default:
      return null
  }
}

export function readLiteralEscape(line: string, position: number, site?: PostingSiteId) {
  const profile = site && postingProfile(site)
  if (site === 'hameln' && line.startsWith('《！《', position)) {
    const marker = /《！《([^《》\n]+)》》/y
    marker.lastIndex = position
    const match = marker.exec(line)
    if (match) return { length: match[0].length, text: '《《' + match[1] + '》》' }
  }
  if (!/[｜|]/.test(line[position] ?? '')) return
  const opening = line[position + 1]
  const parentheses = profile && profile.parens
  if (
    (opening === '《' && (!site || (profile && profile.escapeAngle))) ||
    (profile &&
      profile.escapeParens &&
      ((opening === '（' && parentheses !== 'ascii') ||
        (opening === '(' && (parentheses === 'narou' || parentheses === 'ascii'))))
  )
    return { length: 2, text: opening }
}

export function writeLiteralNotation(
  value: string,
  site: PostingSiteId,
  warn: (value: string, offset: number) => void,
) {
  const profile = postingProfile(site)
  const parens = parentheses(site)
  if (profile.escapeParens !== true && parens) {
    const brackets = site === 'akatsuki' ? /^(?:（[^）]+）|\(\([^)]*\)\))/ : /^\([^)]*\)/
    for (const match of value.matchAll(parens)) {
      const end = match.index + match[0].length
      const suffix = brackets.exec(value.slice(end))?.[0]
      if (suffix) warn(match[0] + suffix, match.index)
    }
    if (site === 'akatsuki') {
      for (const match of value.matchAll(/〖[^〗]+〗（[^）]+）/g)) warn(match[0], match.index)
    }
  }

  const escapedOpenings = new Set<number>()
  if (profile.ruby === 'angle' && profile.escapeAngle !== true) {
    const record = (match: RegExpMatchArray, offset: number) => {
      warn(match[0], offset)
      if (profile.escapeAngle !== 'preview') return
      for (const bracket of match[0].matchAll(/《/g)) escapedOpenings.add(offset + bracket.index)
    }
    for (const match of value.matchAll(angleRuby)) record(match, match.index)
    if (profile.auto || site === 'tales') {
      const reading = site === 'narou' ? kana + '{1,10}' : '[^《》\\n]+'
      const bare = new RegExp(han + '+《' + reading + '》', 'gu')
      for (const match of value.matchAll(bare)) {
        if (!/[｜|]/.test(value[match.index - 1] ?? '')) record(match, match.index)
      }
    }
    if (profile.dots === 'angle' && !profile.escapeDots) {
      for (const match of value.matchAll(rubyDots)) record(match, match.index)
    }
    if (profile.escapeAngle === 'preview') {
      for (const match of value.matchAll(/[｜|]《/g)) {
        if (!escapedOpenings.has(match.index + 1)) record(match, match.index)
      }
    }
  }
  if (profile.escapeDots) {
    for (const match of value.matchAll(ambiguousHamelnEscape)) warn(match[0], match.index)
  }

  let output = value
  if (profile.escapeAngle === true) output = output.replaceAll('《', '｜《')
  if (escapedOpenings.size) {
    output = output.replace(/《/g, (bracket, offset) =>
      escapedOpenings.has(offset) ? '｜《' : bracket,
    )
  }
  if (profile.escapeDots) output = output.replace(rubyDots, (match) => '《！' + match.slice(1))
  if (profile.escapeParens && parens) {
    const existingPipe =
      profile.parens === 'narou'
        ? /[｜|](?=[（(])/g
        : profile.parens === 'ascii'
          ? /[｜|](?=\()/g
          : /[｜|](?=（)/g
    if (profile.escapeParens === 'preview') {
      for (const match of value.matchAll(existingPipe)) warn(match[0] + '(', match.index)
    }
    output = output.replace(existingPipe, '$&｜').replace(parens, '$&｜')
  }
  return output
}
