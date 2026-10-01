import { plainTextOfBlock } from '../game'
import type { Block } from '../schema'
import { classifyScriptBlock } from '../script'
import {
  DEFAULT_FRONT_MATTER,
  normalizeScriptText,
  type SheetFrontMatter,
  type SheetSource,
} from '../script/layout'
import type { ZipInput } from '../zip'

/**
 * 脚本 → Word（.docx）。提出でよく使われる「原稿用紙設定」のテンプレートに合わせる。
 *
 * - 用紙は横置き・縦書き（tbRl）・20字×20行の行グリッド。A4（14pt）と B5（12pt）。
 * - 段落スタイルは「柱書き」（行頭）「ト書き」（3字下げ）「セリフ」（2行目以降1字ぶら下げ）。
 *   Word 側でスタイルとして持たせるので、貼り直しや募集要項への手直しがしやすい。
 * - 前付け（表紙・人物一覧表・あらすじ）はそれぞれ独立したページにし、本文とは別の節に置く。
 *   ページ番号は本文の1頁目を1にする。
 * - 依存ライブラリは持たず、必要な XML パートだけを組んで自前の zip（無圧縮）に入れる。
 */

export type DocxPaper = 'a4' | 'b5'

interface DocxPreset {
  paper: DocxPaper
  label: string
  /** 用紙サイズ（twip・横置きなので w > h）。 */
  pageW: number
  pageH: number
  /** Word の用紙コード（9=A4, 13=B5）。 */
  pageCode: number
  /** 本文の文字サイズ（half-point）。 */
  sz: number
  /** 行グリッド（原稿用紙設定が決める値をテンプレートから写す）。 */
  linePitch: number
  charSpace: number
  /** ト書きの字下げ（twip）／セリフのぶら下げ（twip）。3字・1字ぶんを twip で。 */
  directionIndent: number
  dialogueHang: number
  /** 表紙の題名・著者名の文字サイズ（half-point）。本文より少し大きい程度に抑える（手直し前提）。 */
  titleSz: number
  authorSz: number
  /** 句読点の詰め（テンプレートの設定を写す）。 */
  spacingControl: 'compressPunctuation' | 'doNotCompress'
}

export const DOCX_PRESETS: Record<DocxPaper, DocxPreset> = {
  a4: {
    paper: 'a4',
    label: 'A4・14pt',
    pageW: 16838,
    pageH: 11906,
    pageCode: 9,
    sz: 28,
    linePitch: 657,
    charSpace: 29736,
    directionIndent: 1276,
    dialogueHang: 425,
    titleSz: 48,
    authorSz: 32,
    spacingControl: 'compressPunctuation',
  },
  b5: {
    paper: 'b5',
    label: 'B5・12pt',
    pageW: 14572,
    pageH: 10319,
    pageCode: 13,
    sz: 24,
    linePitch: 544,
    charSpace: 27822,
    directionIndent: 1128,
    dialogueHang: 376,
    titleSz: 40,
    authorSz: 28,
    spacingControl: 'doNotCompress',
  },
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

export function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

/** 1 段落。style は段落スタイル ID、rPr は run の書式、ind は字下げ。 */
function para(
  text: string,
  opts: { style?: string; ind?: string; jc?: string; rPr?: string; before?: string } = {},
): string {
  const pPr = [
    opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '',
    opts.ind ?? '',
    opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '',
    opts.rPr ? `<w:rPr>${opts.rPr}</w:rPr>` : '',
  ].join('')
  const run =
    text === ''
      ? ''
      : `<w:r>${opts.rPr ? `<w:rPr>${opts.rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  return `<w:p>${pPr ? `<w:pPr>${opts.before ?? ''}${pPr}</w:pPr>` : ''}${run}</w:p>`
}

const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

const TRANSITION = '×　　×　　×'

/** 本文ブロック列 → 段落 XML（柱書き／ト書き／セリフのスタイルを付ける）。 */
export function scriptBlocksToDocxParagraphs(blocks: Block[]): string[] {
  const out: string[] = []
  const blank = () => {
    if (out.length > 0 && out[out.length - 1] !== para('')) out.push(para(''))
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
        out.push(para(text, { style: 'Hashira' }))
        break
      case 'transition':
        blank()
        out.push(para(TRANSITION, { style: 'Togaki' }))
        blank()
        break
      case 'dialogue':
        out.push(para(text, { style: 'Serifu' }))
        break
      default:
        out.push(para(text, { style: 'Togaki' }))
    }
  }
  while (out.length > 0 && out[out.length - 1] === para('')) out.pop()
  return out
}

function sectPr(
  preset: DocxPreset,
  opts: { footer: boolean; numberFrom1: boolean; vCenter?: boolean },
): string {
  // vAlign center は縦書きでは列の並び（左右）を紙の中央に寄せる。表紙の題名を中央に置くために使う。
  return `<w:sectPr>${opts.footer ? '<w:footerReference w:type="default" r:id="rId3"/>' : ''}<w:pgSz w:w="${preset.pageW}" w:h="${preset.pageH}" w:orient="landscape" w:code="${preset.pageCode}"/><w:pgMar w:top="1701" w:right="1985" w:bottom="1701" w:left="1701" w:header="851" w:footer="992" w:gutter="0"/>${opts.numberFrom1 ? '<w:pgNumType w:start="1"/>' : ''}<w:cols w:space="425"/><w:textDirection w:val="tbRl"/><w:docGrid w:type="linesAndChars" w:linePitch="${preset.linePitch}" w:charSpace="${preset.charSpace}"/>${opts.vCenter ? '<w:vAlign w:val="center"/>' : ''}</w:sectPr>`
}

/** 表紙：題名を紙の中央（行方向は jc center、列の並びは節の vAlign center）に置き、著者名を次の行の行末寄せで添える。 */
function coverParagraphs(source: SheetSource, preset: DocxPreset): string[] {
  const out: string[] = [
    para(normalizeScriptText(source.title.trim() || '無題'), {
      jc: 'center',
      rPr: `<w:sz w:val="${preset.titleSz}"/><w:szCs w:val="${preset.titleSz}"/>`,
    }),
  ]
  if (source.author?.trim()) {
    // 字下げで寄せると短い行幅で折り返すので jc を使う。
    out.push(para(''))
    out.push(
      para(normalizeScriptText(source.author.trim()), {
        jc: 'right',
        rPr: `<w:sz w:val="${preset.authorSz}"/><w:szCs w:val="${preset.authorSz}"/>`,
      }),
    )
  }
  return out
}

/** 人物一覧表・あらすじ（それぞれ独立したページ）。 */
function frontMatterParagraphs(source: SheetSource, front: SheetFrontMatter): string[] {
  const out: string[] = []
  if (front.cast && source.cast && source.cast.length > 0) {
    out.push(para('【人物一覧表】'))
    for (const c of source.cast) {
      const name = normalizeScriptText(c.name.trim())
      const note = c.note?.trim() ? normalizeScriptText(c.note.replace(/\s+/gu, ' ').trim()) : ''
      out.push(para(note ? `${name}…${note}` : name))
    }
  }
  if (front.synopsis && source.synopsis?.trim()) {
    if (out.length > 0) out.push(pageBreak())
    out.push(para('【あらすじ】'))
    for (const p of source.synopsis.replace(/\r\n?/gu, '\n').split('\n')) {
      const t = p.trim()
      out.push(t ? para(`　${normalizeScriptText(t)}`) : para(''))
    }
  }
  while (out.length > 0 && out[out.length - 1] === para('')) out.pop()
  return out
}

export function buildDocumentXml(
  source: SheetSource,
  front: SheetFrontMatter,
  preset: DocxPreset,
): string {
  const coverParas = front.cover ? coverParagraphs(source, preset) : []
  const frontParas = frontMatterParagraphs(source, front)
  // 話のタイトルは載せない（提出用の本文は題名から続けて柱で始める）。話が複数なら改ページで続ける。
  const body: string[] = []
  source.episodes.forEach((ep, i) => {
    if (i > 0) body.push(pageBreak())
    body.push(...scriptBlocksToDocxParagraphs(ep.blocks))
  })
  // 表紙は中央寄せの節、人物一覧表・あらすじは通常の節。どちらも本文とは別の節にして、ページ番号は本文から振る
  // （節の切れ目は段落の pPr に置き、次の節は新しいページから始まる）。
  const endSection = (opts: { vCenter?: boolean }) =>
    `<w:p><w:pPr>${sectPr(preset, { footer: false, numberFrom1: false, ...opts })}</w:pPr></w:p>`
  const coverSection =
    coverParas.length > 0 ? `${coverParas.join('')}${endSection({ vCenter: true })}` : ''
  const frontSection = frontParas.length > 0 ? `${frontParas.join('')}${endSection({})}` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${coverSection}${frontSection}${body.join('')}${sectPr(preset, { footer: true, numberFrom1: true })}</w:body></w:document>`
}

export function buildStylesXml(preset: DocxPreset): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="游明朝" w:eastAsia="游明朝" w:hAnsi="游明朝" w:cs="Times New Roman"/><w:kern w:val="2"/><w:sz w:val="21"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="${preset.sz}"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4252"/><w:tab w:val="right" w:pos="8504"/></w:tabs><w:snapToGrid w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Hashira"><w:name w:val="柱書き"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Togaki"><w:name w:val="ト書き"/><w:basedOn w:val="Hashira"/><w:qFormat/><w:pPr><w:ind w:leftChars="300" w:left="${preset.directionIndent}"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Serifu"><w:name w:val="セリフ"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="${preset.dialogueHang}" w:hangingChars="100" w:hanging="${preset.dialogueHang}"/></w:pPr></w:style>
</w:styles>`
}

export function buildFooterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">PAGE   \\* MERGEFORMAT</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`
}

export function buildSettingsXml(preset: DocxPreset): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W_NS}><w:defaultTabStop w:val="840"/><w:characterSpacingControl w:val="${preset.spacingControl}"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
}

function buildFontTableXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts ${W_NS}><w:font w:name="游明朝"><w:charset w:val="80"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font><w:font w:name="Times New Roman"><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`
}

function buildCoreXml(title: string, author: string | undefined, now: number): string {
  const iso = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author ?? '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`
}

/** .docx を構成するパート一覧（zipStore に渡す）。 */
export function buildDocxFiles(
  source: SheetSource,
  opts: { paper?: DocxPaper; front?: SheetFrontMatter; now?: number } = {},
): ZipInput[] {
  const preset = DOCX_PRESETS[opts.paper ?? 'a4']
  const front = opts.front ?? DEFAULT_FRONT_MATTER
  return [
    {
      path: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      path: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    { path: 'word/document.xml', data: buildDocumentXml(source, front, preset) },
    {
      path: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>`,
    },
    { path: 'word/styles.xml', data: buildStylesXml(preset) },
    { path: 'word/settings.xml', data: buildSettingsXml(preset) },
    { path: 'word/footer1.xml', data: buildFooterXml() },
    { path: 'word/fontTable.xml', data: buildFontTableXml() },
    {
      path: 'docProps/core.xml',
      data: buildCoreXml(source.title, source.author, opts.now ?? Date.now()),
    },
    {
      path: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>コトノハ-leaf-</Application></Properties>`,
    },
  ]
}
