import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { readArchive } from '../zip/read'
import { postingDocx } from './posting-docx'

describe('投稿用のWordファイル', () => {
  it('記法、空行、前後の空白、タブ、XML予約文字を保つ', async () => {
    const blocks = ['  灯台《とうだい》<&>🕯', '', '\t《《強調》》 ', '']
    const files = await readArchive(postingDocx(blocks.join('\n')), 100_000)
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    const xml = new TextDecoder().decode(files.get('word/document.xml'))
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const paragraphs = Array.from(document.getElementsByTagName('w:p')).map(({ firstChild }) =>
      Array.from(firstChild?.childNodes ?? [])
        .map((node) => (node.nodeName === 'w:tab' ? '\t' : node.textContent))
        .join(''),
    )
    expect(paragraphs).toEqual(blocks)
  })

  it('XMLに使えない制御文字があれば保存エラーにする', () => {
    expect(() => postingDocx('本文' + String.fromCharCode(0))).toThrow('制御文字')
  })
})
