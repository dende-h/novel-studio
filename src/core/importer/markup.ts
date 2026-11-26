import { DOMParser } from '@xmldom/xmldom'
import { type DefaultTreeAdapterTypes as Html, parse } from 'parse5'
import { illustrationFileTag } from '../sites/illustrations'
import { validArchivePath } from '../zip/read'
import { linkedImage } from './local-image'
import { fileName, fileTitle, type ManuscriptAsset, type ManuscriptSource } from './site-formats'
import { decodeTextFile, normalizeImportedText } from './text'

function memberPath(base: string, href: string): string | undefined {
  let local: string
  try {
    local = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? '')
  } catch {
    return
  }
  if (/^\/|[\\:]/.test(local) || !local) return
  const result = base.split('/').slice(0, -1)
  for (const segment of local.split('/')) {
    if (segment === '..') {
      if (!result.length) return
      result.pop()
    } else if (segment && segment !== '.') result.push(segment)
  }
  const path = result.join('/')
  return validArchivePath(path) ? path : undefined
}

function reader(files: Map<string, Uint8Array>) {
  return (path: string) => {
    const bytes = files.get(path)
    const text = bytes && decodeTextFile(bytes)
    if (!text) throw new Error(`「${path}」がないか、文字を読み込めません`)
    return text.text
  }
}

function imageHandler(files: Map<string, Uint8Array>, assets: Map<string, ManuscriptAsset>) {
  return (relativeTo: string, src: string, alt: string) => {
    const path = memberPath(relativeTo, src)
    return path
      ? linkedImage(path, files.get(path), assets)
      : illustrationFileTag(alt || src || '外部の挿絵')
  }
}

function xml(text: string) {
  // No DTD/entity resolution is needed for EPUB package metadata.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('外部定義のあるEPUB目録は読み込めません')
  return new DOMParser({
    onError: (level) => {
      if (level !== 'warning') throw new Error('EPUBのXMLを読み込めません')
    },
  }).parseFromString(text, 'application/xml')
}

function descendants(node: Html.Node): Html.Element[] {
  if (!('childNodes' in node)) return []
  return node.childNodes.flatMap((child) =>
    'tagName' in child ? [child, ...descendants(child)] : [],
  )
}

const attr = (node: Html.Element, name: string) =>
  node.attrs.find((a) => a.name === name)?.value ?? ''
const cls = (node: Html.Element, value: string) => attr(node, 'class').split(/\s+/).includes(value)
const ignored = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'noscript',
  'svg',
  'rp',
  'template',
])
const paragraph = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

function htmlText(
  node: Html.Node,
  opts: { image?: (src: string, alt: string) => string; paragraphs?: boolean } = {},
): string {
  if ('value' in node) return node.value
  if (!('childNodes' in node)) return ''
  if ('tagName' in node) {
    if (ignored.has(node.tagName)) return ''
    if (node.tagName === 'img') return opts.image?.(attr(node, 'src'), attr(node, 'alt')) ?? ''
    if (node.tagName === 'br') return '\n'
    if (node.tagName === 'ruby') {
      const base = node.childNodes
        .filter((e) => !('tagName' in e) || e.tagName !== 'rt')
        .map((e) => htmlText(e, opts))
        .join('')
      const ruby = node.childNodes
        .filter((e) => 'tagName' in e && e.tagName === 'rt')
        .map((e) => htmlText(e, opts))
        .join('')
      return base && ruby ? `｜${base}《${ruby}》` : base
    }
    if (node.tagName === 'em') {
      const body = node.childNodes.map((e) => htmlText(e, opts)).join('')
      return body ? `《《${body}》》` : ''
    }
  }
  const text = node.childNodes
    .map((child) => {
      if (opts.paragraphs && 'value' in child && !child.value.trim() && child.value.includes('\n'))
        return ''
      return htmlText(child, opts)
    })
    .join('')
  return opts.paragraphs && 'tagName' in node && paragraph.has(node.tagName) && !text.endsWith('\n')
    ? `${text}\n`
    : text
}

export function readEpub(name: string, files: Map<string, Uint8Array>): ManuscriptSource {
  const read = reader(files)
  if (read('mimetype') !== 'application/epub+zip') throw new Error('EPUBの種類を確認できません')
  const root = xml(read('META-INF/container.xml'))
    .getElementsByTagNameNS('*', 'rootfile')
    .item(0)
    ?.getAttribute('full-path')
  if (!root || !validArchivePath(root)) throw new Error('EPUBの目録が見つかりません')
  const pkg = xml(read(root))
  const first = (tag: string) =>
    pkg.getElementsByTagNameNS('*', tag).item(0)?.textContent?.trim() || undefined
  const items = Array.from(pkg.getElementsByTagNameNS('*', 'item'))
  const manifest = new Map(items.map((item) => [item.getAttribute('id'), item]))
  const spine = Array.from(
    pkg.getElementsByTagNameNS('*', 'spine').item(0)?.getElementsByTagNameNS('*', 'itemref') ?? [],
  )
  if (!spine.length) throw new Error('EPUBに読む順序がありません')
  const titles = new Map<string, string>()
  const nav = items.find((item) => item.getAttribute('properties')?.split(/\s+/).includes('nav'))
  const navPath = nav && memberPath(root, nav.getAttribute('href') ?? '')
  if (navPath) {
    for (const node of descendants(parse(read(navPath)))) {
      const path = node.tagName === 'a' && memberPath(navPath, attr(node, 'href'))
      if (path && !titles.has(path)) titles.set(path, htmlText(node).trim())
    }
  } else {
    const ncx = manifest.get(
      pkg.getElementsByTagNameNS('*', 'spine').item(0)?.getAttribute('toc') ?? '',
    )
    const ncxPath = ncx && memberPath(root, ncx.getAttribute('href') ?? '')
    if (ncxPath)
      for (const point of Array.from(xml(read(ncxPath)).getElementsByTagNameNS('*', 'navPoint'))) {
        const path = memberPath(
          ncxPath,
          point.getElementsByTagNameNS('*', 'content').item(0)?.getAttribute('src') ?? '',
        )
        const title = point.getElementsByTagNameNS('*', 'text').item(0)?.textContent?.trim()
        if (path && title && !titles.has(path)) titles.set(path, title)
      }
  }
  const assets = new Map<string, ManuscriptAsset>()
  const image = imageHandler(files, assets)
  const seen = new Set<string>()
  const episodes = spine.flatMap((entry) => {
    if (entry.getAttribute('linear') === 'no') return []
    const item = manifest.get(entry.getAttribute('idref'))
    const path = item && memberPath(root, item.getAttribute('href') ?? '')
    if (!path || seen.has(path)) throw new Error('EPUBの読む順序と本文ファイルが一致しません')
    seen.add(path)
    if (path === navPath || item?.getAttribute('properties')?.split(/\s+/).includes('nav'))
      return []
    if (!/^application\/xhtml\+xml$|^text\/html$/.test(item?.getAttribute('media-type') ?? '')) {
      throw new Error(`EPUBの本文が対応するHTML形式ではありません（${path}）`)
    }
    const elements = descendants(parse(read(path)))
    const content = elements.find((node) => node.tagName === 'body')!
    const title =
      titles.get(path) ||
      elements
        .filter((node) => node.tagName === 'h1' || node.tagName === 'title')
        .map((node) => htmlText(node).trim())
        .find(Boolean) ||
      fileTitle(path)
    const body = htmlText(content, {
      paragraphs: true,
      image: (src, alt) => image(path, src, alt),
    }).replace(/\n$/, '')
    return body.trim() ? [{ path, title, body }] : []
  })
  if (!episodes.length) throw new Error('EPUBに文字のある本文が見つかりません')
  return {
    name,
    title: first('title') ?? fileTitle(name),
    author: first('creator'),
    description: first('description'),
    episodes,
    warnings: ['EPUBの読む順序で表示しています。話の境界と挿絵の位置を確認してください。'],
    assets: [...assets.values()],
    structured: true,
  }
}

export function readAkatsukiHtml(
  name: string,
  files: Map<string, Uint8Array>,
  index: string,
): ManuscriptSource {
  const read = reader(files)
  const elements = descendants(parse(read(index)))
  const title = elements.find((node) => node.tagName === 'h1')
  if (!title) throw new Error('アカツキのHTML目次を読み込めません')
  const assetMap = new Map<string, ManuscriptAsset>()
  const image = imageHandler(files, assetMap)
  const links = elements.flatMap((node) => {
    const path = node.tagName === 'a' && memberPath(index, attr(node, 'href'))
    const number = path && /^(\d{4,})_.+\.html?$/i.exec(fileName(path))?.[1]
    return path && number ? [{ path, number: Number(number), title: htmlText(node).trim() }] : []
  })
  if (!links.length || new Set(links.map((link) => link.number)).size !== links.length)
    throw new Error('アカツキのHTML目次の話順を確認できません')
  const episodes = links
    .sort((a, b) => a.number - b.number)
    .map((link) => {
      const nodes = descendants(parse(read(link.path)))
      const main = nodes.find((node) => cls(node, 'body'))
      if (!main) throw new Error(`本文欄がありません（${link.path}）`)
      const inline = { image: (src: string, alt: string) => image(link.path, src, alt) }
      const body = normalizeImportedText(htmlText(main, inline)).replace(/^\n|\n$/g, '')
      if (!body.trim()) throw new Error(`本文が空です（${link.path}）`)
      const heading = nodes.find((node) => node.tagName === 'h1')
      const findNote = (caption: string) => {
        const index = nodes.findIndex(
          (node) => cls(node, 'caption') && htmlText(node).trim() === caption,
        )
        const note = index >= 0 && nodes[index + 1]
        if (!note || !cls(note, 'note')) return undefined
        return normalizeImportedText(htmlText(note, inline)).replace(/^\n|\n$/g, '')
      }
      const before = findNote('前書き')
      const after = findNote('後書き')
      return {
        path: link.path,
        title: (heading && htmlText(heading).replace(/\n$/, '')) || link.title,
        body,
        before,
        after,
        site: 'akatsuki' as const,
      }
    })
  const author = elements.find((node) => cls(node, 'author'))
  const reference = elements.find((node) => cls(node, 'reference'))
  return {
    name,
    title: htmlText(title).trim(),
    author: author && htmlText(author).trim(),
    description: reference && htmlText(reference).trim(),
    episodes,
    assets: [...assetMap.values()],
    warnings: [],
    structured: true,
  }
}
