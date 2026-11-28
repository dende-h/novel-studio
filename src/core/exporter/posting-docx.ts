import { zipStore } from '../zip'
import { escapeXml } from './toDocx'

/** Word にも貼り付け用の記法を文字のまま入れ、空行とタブを保つ。 */
export function postingDocx(text: string): Uint8Array {
  // XML 1.0 に書けない文字は黙って落とさず、保存時に知らせる。
  // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 で許可されない文字を検査する
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text)) {
    throw new Error('Word形式に保存できない制御文字が本文に含まれています。')
  }
  const paragraphs = text.split(/\r\n?|\n/).map((line) => {
    const runs = line
      .split('\t')
      .map((part) => '<w:t xml:space="preserve">' + escapeXml(part) + '</w:t>')
      .join('<w:tab/>')
    return '<w:p><w:r>' + runs + '</w:r></w:p>'
  })
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  return zipStore([
    {
      path: '[Content_Types].xml',
      data:
        xml +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      path: '_rels/.rels',
      data:
        xml +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      path: 'word/document.xml',
      data:
        xml +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        paragraphs.join('') +
        '</w:body></w:document>',
    },
  ])
}
