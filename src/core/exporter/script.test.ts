import { expect, it } from 'vitest'
import { setWorkMeta } from '../mcp-edit'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work } from '../schema'
import { buildEpubFiles } from './toEpub'
import { blocksToKakuyomu } from './toKakuyomu'
import { blocksToNarou } from './toNarou'
import { blocksToPlainText, workToPlainText } from './toPlainText'

const body = '○公園\n　看板に「禁止」とある\nユイ（声）「…」\n「はい」\n\n　'
const work: Work = {
  id: 'w',
  title: '題',
  author: '著者',
  description: '概要',
  coverImage: 'data:image/jpeg;base64,AA',
  episodes: [{ id: 'ep', title: '第一話', blocks: parseEpisodeBody(body) }],
}
it('EPUB・なろう・カクヨムは小説専用で、形式が脚本でも出力は変わらない（脚本は PDF）', () => {
  expect(buildEpubFiles({ ...work, format: 'script' })).toEqual(buildEpubFiles(work))
  const css = buildEpubFiles(work).find((f) => f.path.endsWith('style.css'))?.content
  expect(css).not.toContain('sc-')
  for (const line of ['　x', 'x', '　　　　x', body]) {
    expect(blocksToNarou(parseEpisodeBody(line))).toBe(line)
    expect(blocksToKakuyomu(parseEpisodeBody(line))).toBe(line)
  }
})
it('AI向けの本文はそのまま、形式はメタに表示する', () => {
  expect(blocksToPlainText(parseEpisodeBody(body))).toBe(body)
  expect(workToPlainText({ ...work, format: 'script' })).toContain('形式: 脚本')
  expect(workToPlainText({ ...work, format: 'script' })).toContain(body)
  expect(workToPlainText(work)).not.toContain('形式:')
})
it('MCP の形式パッチは他欄を保ち、小説はキーを削除する', () => {
  const script = setWorkMeta([work], 'w', { format: 'script' }, 1)
  expect(script[0]).toEqual({ ...work, format: 'script', updatedAt: 1 })
  expect(setWorkMeta(script, 'w', { title: '新題' }, 2)[0]?.format).toBe('script')
  expect(setWorkMeta(script, 'w', { format: 'novel' }, 3)[0]).toEqual({ ...work, updatedAt: 3 })
  expect(work).not.toHaveProperty('format')
  // 梗概：渡した項目だけ更新し、空文字でキーを消す。AI 向け本文には脚本のときだけ載る
  const withSynopsis = setWorkMeta(script, 'w', { synopsis: '結末まで。' }, 4)
  expect(withSynopsis[0]?.synopsis).toBe('結末まで。')
  expect(withSynopsis[0]?.format).toBe('script')
  expect(workToPlainText(withSynopsis[0] as Work)).toContain('梗概:\n結末まで。')
  expect(workToPlainText({ ...(withSynopsis[0] as Work), format: undefined })).not.toContain(
    '梗概:',
  )
  expect(setWorkMeta(withSynopsis, 'w', { synopsis: '' }, 5)[0]).not.toHaveProperty('synopsis')
})
