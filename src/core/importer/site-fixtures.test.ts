// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildImportedWork, decodeTextFile } from '.'

const fixtureRoot = new URL('../../../docs/specs/posting-import-fixtures/', import.meta.url)

function sample(path: string): Uint8Array {
  return readFileSync(new URL(path, fixtureRoot))
}

describe('投稿サイトの合成サンプルで既存TXT取込を確認', () => {
  it('UTF-8の本文からルビ、空段落、通常の文字列を読み込む', () => {
    const decoded = decodeTextFile(sample('fallback/novel-days-body.txt'))
    expect(decoded?.encoding).toBe('utf-8')
    const work = buildImportedWork(
      { title: '観測日誌', episodes: [{ title: '第一夜', body: decoded?.text ?? '' }] },
      () => 'test-id',
      () => 0,
    )
    const paragraphs = work.episodes[0]?.blocks.map((block) => block.inlines) ?? []
    expect(decoded?.text.length).toBeGreaterThanOrEqual(900)
    expect(paragraphs.length).toBeGreaterThan(10)
    expect(paragraphs.slice(0, 2)).toEqual([
      [
        { type: 'ruby', base: '灯台', reading: 'とうだい' },
        { type: 'text', text: 'を点ける。' },
      ],
      [],
    ])
    expect(paragraphs.flat()).toContainEqual({
      type: 'text',
      text: expect.stringContaining('[unknown:灯りを残す]'),
    })
  })

  it('一括TXTを想定したCP932の本文とCRLFを復号する', () => {
    const decoded = decodeTextFile(sample('mock/alphapolis.txt'))
    expect(decoded?.encoding).toBe('shift_jis')
    expect(decoded?.text).toContain('第1話 灯り　第一夜\n')
    expect(decoded?.text).toContain('第2話 灯り 第二夜\n')
    expect(decoded?.text).toContain('第3話 灯り 第三夜\n')
    expect(decoded?.text).not.toContain('\r')
  })

  it('画像をTXTに改名した入力を拒否する', () => {
    expect(decodeTextFile(sample('rejected/image-renamed.txt'))).toBeNull()
  })
})
