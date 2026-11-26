export interface IllustrationReference {
  site: 'narou' | 'pixiv' | 'hameln' | 'akatsuki' | 'file' | 'mitemin'
  raw: string
  name: string
  offset: number
  assetPath?: string
  tag?: string
}

const imageTag =
  /＜i\d+[a-z]*[｜|]\d+＞|<i\d+[a-z]*[｜|]\d+>|\[(?:pixivimage:\d+(?:-\d+)?|uploadedimage:\d+)\]|\{IMG\d+\}|\[挿絵(?:参照|タグ):[^\]\n]+\]/gi

export function illustrationFileTag(path: string, key?: string): string {
  return `[挿絵参照:${encodeURIComponent(path)}${key ? `|${key}` : ''}]`
}

export function siteIllustrationTag(site: 'akatsuki' | 'narou', tag: string) {
  return `[挿絵タグ:${site}:${encodeURIComponent(tag)}]`
}

export function illustrationReferences(text: string): IllustrationReference[] {
  return Array.from(text.matchAll(imageTag), (match) => {
    const raw = match[0]
    const sourced = /^\[挿絵タグ:(akatsuki|narou):([^\]]+)\]$/.exec(raw)
    const decoded = sourced?.[2] && decodeTag(sourced[2])
    const tag = decoded && /^<i\d+[a-z]*[｜|]\d+>$/i.test(decoded) ? decoded : undefined
    const site = tag
      ? (sourced?.[1] as 'narou' | 'akatsuki')
      : raw.startsWith('[挿絵参照:')
        ? 'file'
        : raw.startsWith('[')
          ? 'pixiv'
          : raw.startsWith('＜')
            ? 'narou'
            : raw.startsWith('<')
              ? 'mitemin'
              : 'hameln'
    let name = tag ?? raw
    let assetPath: string | undefined
    if (site === 'file') {
      const [encoded = '', key] = raw.slice('[挿絵参照:'.length, -1).split('|', 2)
      try {
        name = decodeURIComponent(encoded)
      } catch {
        name = encoded
      }
      if (key && /^[a-f0-9]+-\d+$/.test(key)) assetPath = `${key}/${name}`
    }
    return { site, raw, name, assetPath, tag, offset: match.index }
  })
}

function decodeTag(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}
