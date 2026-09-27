import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { SheetSource } from '../script/layout'
import { zipStore } from '../zip'
import {
  buildDocumentXml,
  buildDocxFiles,
  buildFooterXml,
  buildStylesXml,
  DOCX_PRESETS,
  scriptBlocksToDocxParagraphs,
} from './toDocx'

const source: SheetSource = {
  title: '月と剣 <試>',
  author: '著者名',
  cast: [{ name: 'ユイ', note: '十七歳。\n高校生。' }, { name: 'ケン' }],
  synopsis: '一行目。\n\n結末まで。',
  episodes: [
    {
      title: '',
      blocks: parseEpisodeBody(
        '○公園（夕方）\n\n\n風が吹く。No.1の看板。\nユイ（声）「え！なに？」\n「うん」\n***\n○家',
      ),
    },
  ],
}
const ALL = { cover: true, cast: true, synopsis: true }
const NONE = { cover: false, cast: false, synopsis: false }

/** 閉じ忘れや属性の壊れを拾う簡易チェック（開始タグと終了タグの釣り合い）。 */
function assertBalanced(xml: string) {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:]+)[^>]*?(\/?)>/g)) {
    if (m[0].startsWith('<?')) continue
    const [, close, name, selfClose] = m
    if (selfClose) continue
    if (close) expect(stack.pop()).toBe(name)
    else stack.push(name as string)
  }
  expect(stack).toEqual([])
}

it('本文の段落に柱書き／ト書き／セリフのスタイルを付け、空行は1つに畳み、！？の後ろを空け半角を全角にする', () => {
  const paras = scriptBlocksToDocxParagraphs(source.episodes[0]?.blocks ?? [])
  const styles = paras.map((p) => /w:pStyle w:val="([A-Za-z]+)"/.exec(p)?.[1] ?? '')
  expect(styles).toEqual(['Hashira', '', 'Togaki', 'Serifu', 'Serifu', '', 'Togaki', '', 'Hashira'])
  expect(paras[2]).toContain('<w:t xml:space="preserve">風が吹く。Ｎｏ．１の看板。</w:t>')
  expect(paras[3]).toContain('ユイ（声）「え！　なに？」')
  expect(paras[6]).toContain('×　　×　　×')
  // ト書きの字下げは本文の空白ではなくスタイルで付ける（テキストには入れない）
  expect(paras[2]).not.toContain('　　　風')
})

it('表紙は中央寄せの節、人物一覧表・あらすじは通常の節、本文の節にだけページ番号（1 から）を付ける', () => {
  const xml = buildDocumentXml(source, ALL, DOCX_PRESETS.a4)
  assertBalanced(xml)
  const sects = xml.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? []
  expect(sects).toHaveLength(3)
  expect(sects[0]).toContain('<w:vAlign w:val="center"/>')
  expect(sects[0]).not.toContain('footerReference')
  expect(sects[1]).not.toContain('vAlign')
  expect(sects[1]).not.toContain('footerReference')
  expect(sects[1]).not.toContain('pgNumType')
  expect(sects[2]).not.toContain('vAlign')
  expect(sects[2]).toContain('<w:footerReference w:type="default" r:id="rId3"/>')
  expect(sects[2]).toContain('<w:pgNumType w:start="1"/>')
  // テンプレート（A4_20_20_14）と同じ用紙・余白・縦書き・行グリッド
  expect(sects[2]).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape" w:code="9"/>')
  expect(sects[2]).toContain('<w:textDirection w:val="tbRl"/>')
  expect(sects[2]).toContain(
    '<w:docGrid w:type="linesAndChars" w:linePitch="657" w:charSpace="29736"/>',
  )
  // 表紙 → 人物一覧表 → あらすじ の順。XML はエスケープ
  expect(xml.indexOf('月と剣 &lt;試&gt;')).toBeLessThan(xml.indexOf('【人物一覧表】'))
  expect(xml.indexOf('【人物一覧表】')).toBeLessThan(xml.indexOf('【あらすじ】'))
  expect(xml.indexOf('【あらすじ】')).toBeLessThan(xml.indexOf('○公園（夕方）'))
  // 表紙→人物一覧表は節の切れ目、人物一覧表→あらすじは改ページ、あらすじ→本文は節の切れ目（改ページ1つ）
  expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(1)
  expect(xml.indexOf('<w:br w:type="page"/>')).toBeGreaterThan(xml.indexOf('【人物一覧表】'))
  expect(xml.indexOf('<w:br w:type="page"/>')).toBeLessThan(xml.indexOf('【あらすじ】'))
  // 題名は行の中央（縦書きでは上下中央）。著者名は字下げではなく行末寄せで、短い行幅で折り返さない
  expect(xml).toMatch(/<w:jc w:val="center"\/><w:rPr><w:sz w:val="48"\/>[\s\S]*?月と剣/)
  expect(xml).toMatch(/<w:jc w:val="right"\/><w:rPr><w:sz w:val="32"\/>[\s\S]*?著者名/)
  expect(xml).not.toContain('firstLineChars')
  expect(xml).toContain('ユイ…十七歳。　高校生。')
  expect(xml).toContain('<w:t xml:space="preserve">ケン</w:t>')
  expect(xml).toContain('<w:t xml:space="preserve">　一行目。</w:t>')
})

it('前付けを外すと節は1つだけになり、B5 はテンプレート（B5_20_20_12）の用紙・グリッド・文字サイズになる', () => {
  const xml = buildDocumentXml(source, NONE, DOCX_PRESETS.b5)
  assertBalanced(xml)
  expect(xml.match(/<w:sectPr>/g)).toHaveLength(1)
  expect(xml).not.toContain('【人物一覧表】')
  expect(xml).not.toContain('<w:br w:type="page"/>')
  expect(xml).toContain('<w:pgSz w:w="14572" w:h="10319" w:orient="landscape" w:code="13"/>')
  expect(xml).toContain('w:linePitch="544" w:charSpace="27822"')
  const styles = buildStylesXml(DOCX_PRESETS.b5)
  assertBalanced(styles)
  expect(styles).toContain('<w:name w:val="柱書き"/>')
  expect(styles).toContain('<w:name w:val="ト書き"/>')
  expect(styles).toContain('<w:name w:val="セリフ"/>')
  expect(styles).toContain('<w:ind w:leftChars="300" w:left="1128"/>')
  expect(styles).toContain('<w:ind w:left="376" w:hangingChars="100" w:hanging="376"/>')
  expect(styles).toContain('<w:sz w:val="24"/>')
  expect(styles).toContain('w:eastAsia="游明朝"')
})

it('フッターは PAGE フィールドを中央に置き、docx のパートが揃って zip に入る', () => {
  const footer = buildFooterXml()
  assertBalanced(footer)
  expect(footer).toContain('PAGE   \\* MERGEFORMAT')
  expect(footer).toContain('<w:jc w:val="center"/>')
  const files = buildDocxFiles(source, { paper: 'a4', front: ALL, now: 0 })
  expect(files.map((f) => f.path)).toEqual([
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/styles.xml',
    'word/settings.xml',
    'word/footer1.xml',
    'word/fontTable.xml',
    'docProps/core.xml',
    'docProps/app.xml',
  ])
  for (const f of files) assertBalanced(f.data as string)
  expect(files.find((f) => f.path === 'docProps/core.xml')?.data).toContain(
    '<dc:title>月と剣 &lt;試&gt;</dc:title>',
  )
  const bytes = zipStore(files)
  // zip のローカルヘッダ署名
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
})

it('話が複数なら改ページで続け、話のタイトルは載せない', () => {
  const xml = buildDocumentXml(
    {
      ...source,
      episodes: [
        { title: '第一話', blocks: parseEpisodeBody('風') },
        { title: '第二話', blocks: parseEpisodeBody('雨') },
      ],
    },
    NONE,
    DOCX_PRESETS.a4,
  )
  expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(1)
  expect(xml).not.toContain('第一話')
  expect(xml).not.toContain('第二話')
  expect(xml.indexOf('風')).toBeLessThan(xml.indexOf('雨'))
})
