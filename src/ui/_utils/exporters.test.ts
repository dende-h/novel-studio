import { describe, expect, it } from 'vitest'
import type { Episode, Work } from '../../core/schema'
import {
  episodeKakuyomuExport,
  episodeNarouExport,
  worksBundleExport,
  workEpubExport,
  workFolderZipExport,
} from './exporters'

const ep: Episode = {
  id: 'e1',
  title: '第一話/序',
  blocks: [
    { id: 'b1', type: 'paragraph', inlines: [{ type: 'ruby', base: '漢字', reading: 'かんじ' }] },
    { id: 'b2', type: 'paragraph', inlines: [{ type: 'emphasisDots', text: '重要' }] },
  ],
}
const work: Work = { id: 'w1', title: '夜の物語', episodes: [ep] }

describe('exporters（書き出しビルダー・純粋）', () => {
  it('なろう: .txt、傍点は ｜x《・》 へ degrade、ファイル名は安全化', () => {
    const f = episodeNarouExport('夜の物語', ep)
    expect(f.filename.endsWith('.txt')).toBe(true)
    expect(f.filename).not.toContain('/')
    expect(f.mime).toContain('text/plain')
    expect(f.data).toContain('｜重《・》')
  })

  it('カクヨム: .txt、傍点は 《《》》 のまま', () => {
    const f = episodeKakuyomuExport('夜の物語', ep)
    expect(f.filename.endsWith('.txt')).toBe(true)
    expect(f.data).toContain('《《重要》》')
  })

  it('EPUB: Uint8Array で PK 始まり、.epub 拡張子', () => {
    const f = workEpubExport(work)
    expect(f.filename.endsWith('.epub')).toBe(true)
    expect(f.mime).toBe('application/epub+zip')
    const d = f.data as Uint8Array
    expect(d[0]).toBe(0x50)
    expect(d[1]).toBe(0x4b)
  })

  it('bundle: version 付き JSON', () => {
    const f = worksBundleExport([work])
    expect(f.filename.endsWith('.json')).toBe(true)
    const parsed = JSON.parse(f.data as string)
    expect(parsed.version).toBeDefined()
    expect(parsed.works).toHaveLength(1)
  })

  it('フォルダ zip: Uint8Array で PK 始まり、.zip', () => {
    const f = workFolderZipExport(work)
    expect(f.filename.endsWith('.zip')).toBe(true)
    const d = f.data as Uint8Array
    expect(d[0]).toBe(0x50)
    expect(d[1]).toBe(0x4b)
  })
})
