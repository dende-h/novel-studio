import type { Episode, Work } from '../schema'
import { blocksToHtml } from './toHtml'

/**
 * 正本 → EPUB3（縦書き）構成ファイルの純生成。
 * zip 梱包（mimetype 無圧縮先頭など）は UI 層のライブラリ（fflate 等）に委ねる。
 * ここでは container.xml / content.opf / nav.xhtml / style.css / 各話 XHTML を組み立てる。
 */

export interface EpubFile {
  path: string
  content: string
}

const epubId = (ep: Episode) => `ep-${ep.id}`
const epubHref = (ep: Episode) => `text/${epubId(ep)}.xhtml`

export function episodeToXhtml(ep: Episode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
<head>
<meta charset="UTF-8" />
<title>${escapeXml(ep.title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css" />
</head>
<body>
<h1>${escapeXml(ep.title)}</h1>
${blocksToHtml(ep.blocks)}
</body>
</html>`
}

export function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
</rootfiles>
</container>`
}

export function buildPackageOpf(work: Work): string {
  const manifestItems = work.episodes
    .map((ep) => `<item id="${epubId(ep)}" href="${epubHref(ep)}" media-type="application/xhtml+xml" />`)
    .join('\n')
  const spineItems = work.episodes.map((ep) => `<itemref idref="${epubId(ep)}" />`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${work.id}</dc:identifier>
<dc:title>${escapeXml(work.title)}</dc:title>
<dc:language>ja</dc:language>
<meta property="rendition:layout">reflowable</meta>
<meta property="rendition:spread">auto</meta>
<meta property="rendition:flow">paginated</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
<item id="style" href="style.css" media-type="text/css" />
${manifestItems}
</manifest>
<spine page-progression-direction="rtl">
${spineItems}
</spine>
</package>`
}

export function buildNavXhtml(work: Work): string {
  const items = work.episodes
    .map((ep) => `<li><a href="${epubHref(ep)}">${escapeXml(ep.title)}</a></li>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
<meta charset="UTF-8" />
<title>目次</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>目次</h1>
<ol>
${items}
</ol>
</nav>
</body>
</html>`
}

export function buildStyleCss(): string {
  return `html {
  writing-mode: vertical-rl;
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  font-family: serif;
  line-height: 1.8;
}
p { margin: 0; text-indent: 1em; }
p.blank { text-indent: 0; }
em.dots {
  font-style: normal;
  text-emphasis: filled dot;
  -webkit-text-emphasis: filled dot;
}
hr.scene-break { border: none; margin: 2em 0; }`
}

export function buildEpubFiles(work: Work): EpubFile[] {
  return [
    { path: 'mimetype', content: 'application/epub+zip' },
    { path: 'META-INF/container.xml', content: buildContainerXml() },
    { path: 'OEBPS/content.opf', content: buildPackageOpf(work) },
    { path: 'OEBPS/nav.xhtml', content: buildNavXhtml(work) },
    { path: 'OEBPS/style.css', content: buildStyleCss() },
    ...work.episodes.map((ep) => ({
      path: `OEBPS/${epubHref(ep)}`,
      content: episodeToXhtml(ep),
    })),
  ]
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}
