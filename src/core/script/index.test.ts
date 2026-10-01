import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { type Block, WorkSchema } from '../schema'
import { classifyScriptBlock, splitSpeaker } from './index'

const firstBlock = (text: string): Block => {
  const block = parseEpisodeBody(text)[0]
  if (!block) throw new Error('missing block')
  return block
}

it.each([
  ['', 'blank'],
  ['　 ', 'blank'],
  ['○公園（夕方）', 'slug'],
  ['　〇公園', 'slug'],
  ['　看板に「立入禁止」とある。', 'direction'],
  ['　「声」', 'direction'],
  ['「声」', 'dialogue'],
  ['『声』', 'dialogue'],
  ['ユイ（声）「…」', 'dialogue'],
  ['ユイ ケン「…」', 'direction'],
  [`${'名'.repeat(21)}「…」`, 'direction'],
  ['ユイ（声）（遠く）「…」', 'direction'],
  ['普通のト書き', 'direction'],
  ['[[ユイ]]「…」', 'dialogue'],
  ['ユイ（12345678901）「…」', 'direction'],
])('%s → %s', (text, kind) => {
  expect(classifyScriptBlock(firstBlock(text)).kind).toBe(kind)
})
it.each([
  'ユイ（声）「…」',
  '[[ユイ]]（声）「…」',
  '｜結衣《ゆい》「…」',
])('話者の装飾を保つ: %s', (text) => {
  const block = firstBlock(text)
  const split = splitSpeaker(block.inlines)
  expect(split).not.toBeNull()
  expect(split?.rest).toEqual([{ type: 'text', text: '「…」' }])
  expect(split?.speaker[0]?.type).toBe(block.inlines[0]?.type)
})
it('ト書きに話者はない', () => {
  expect(splitSpeaker(firstBlock('　ユイ「声」').inlines)).toBeNull()
})
it('作品形式は旧データ互換の任意項目', () => {
  const work = { id: 'w', title: '題', episodes: [] }
  expect(WorkSchema.parse(work)).not.toHaveProperty('format')
  expect(WorkSchema.parse({ ...work, format: 'script' }).format).toBe('script')
  expect(WorkSchema.safeParse({ ...work, format: 'unknown' }).success).toBe(false)
})
