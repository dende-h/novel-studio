import { decodeDataUrl } from '../image'
import type { Episode, Work } from '../schema'
import { blocksToHtml, wrapTcy } from './toHtml'

/** 表紙画像の EPUB 内パス・ID・media-type（出力は常に JPEG）。 */
const COVER_PATH = 'OEBPS/images/cover.jpg'
const COVER_HREF = 'images/cover.jpg'
const COVER_MEDIA_TYPE = 'image/jpeg'

/**
 * 正本 → EPUB3（縦書き）構成ファイルの純生成。
 * zip 梱包（mimetype 無圧縮先頭など）は UI 層のライブラリ（fflate 等）に委ねる。
 * ここでは container.xml / content.opf / nav.xhtml / style.css / 各話 XHTML を組み立てる。
 */

export interface EpubFile {
  path: string
  /** XHTML/XML/CSS はテキスト、画像などはバイト列。zip 梱包側（zipStore）が両対応。 */
  content: string | Uint8Array
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
<h1>${wrapTcy(escapeXml(ep.title))}</h1>
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

/** EPUB3 必須の dcterms:modified は秒精度の UTC（ミリ秒・タイムゾーン無し）で出力する。 */
function toUtcSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function buildPackageOpf(work: Work, hasCover = false): string {
  const manifestItems = work.episodes
    .map(
      (ep) =>
        `<item id="${epubId(ep)}" href="${epubHref(ep)}" media-type="application/xhtml+xml" />`,
    )
    .join('\n')
  const spineItems = work.episodes.map((ep) => `<itemref idref="${epubId(ep)}" />`).join('\n')
  // 著者・あらすじは入力があるときだけ dc:creator / dc:description を足す（空白のみは無視）。
  const author = work.author?.trim()
  const description = work.description?.trim()
  const creatorLine = author ? `\n<dc:creator>${escapeXml(author)}</dc:creator>` : ''
  const descriptionLine = description
    ? `\n<dc:description>${escapeXml(description)}</dc:description>`
    : ''
  // 表紙：EPUB2 互換の <meta name="cover"> は dc: 群直後、EPUB3 の cover-image item は manifest に置く。
  // 宣言とファイル実体は buildEpubFiles が同じガード（hasCover）で揃える。
  const coverMeta = hasCover ? '\n<meta name="cover" content="cover-image" />' : ''
  const coverItem = hasCover
    ? `\n<item id="cover-image" href="${COVER_HREF}" media-type="${COVER_MEDIA_TYPE}" properties="cover-image" />`
    : ''
  const modified = toUtcSeconds(work.updatedAt ?? 0)
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${work.id}</dc:identifier>
<dc:title>${escapeXml(work.title)}</dc:title>${creatorLine}${descriptionLine}
<dc:language>ja</dc:language>${coverMeta}
<meta property="dcterms:modified">${modified}</meta>
<meta property="rendition:layout">reflowable</meta>
<meta property="rendition:spread">auto</meta>
<meta property="rendition:flow">paginated</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
<item id="style" href="style.css" media-type="text/css" />${coverItem}
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
.tcy {
  text-combine-upright: all;
  -webkit-text-combine: horizontal;
  -epub-text-combine: horizontal;
}
hr.scene-break { border: none; margin: 2em 0; }`
}

export function buildEpubFiles(work: Work): EpubFile[] {
  // 表紙はここで一度だけバイト化し、その有無で OPF 宣言とファイル実体を揃える
  // （宣言あり・実体なしの壊れた EPUB を防ぐ）。不正な data URL は表紙なしへフォールバック。
  let coverBytes: Uint8Array | undefined
  if (work.coverImage?.startsWith('data:image/')) {
    try {
      coverBytes = decodeDataUrl(work.coverImage)
    } catch {
      coverBytes = undefined
    }
  }
  return [
    { path: 'mimetype', content: 'application/epub+zip' },
    { path: 'META-INF/container.xml', content: buildContainerXml() },
    { path: 'OEBPS/content.opf', content: buildPackageOpf(work, Boolean(coverBytes)) },
    { path: 'OEBPS/nav.xhtml', content: buildNavXhtml(work) },
    { path: 'OEBPS/style.css', content: buildStyleCss() },
    ...(coverBytes ? [{ path: COVER_PATH, content: coverBytes }] : []),
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
