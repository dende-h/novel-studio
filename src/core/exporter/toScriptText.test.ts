import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work } from '../schema'
import { scriptBlocksToLines, scriptToText, sheetSourceOf, workToScriptText } from './toScriptText'

const S = '　'
const work: Work = {
  id: 'w',
  title: '月と剣',
  author: '著者',
  description: '読者向けのあらすじ',
  synopsis: '一行目。\n\n\n結末まで。',
  format: 'script',
  glossary: [
    {
      id: 'g1',
      name: 'ユイ',
      aliases: [],
      category: '人物',
      summary: '十七歳。\n高校生。',
      createdAt: 0,
      updatedAt: 0,
    },
    { id: 'g2', name: 'ケン', aliases: [], category: '人物', createdAt: 0, updatedAt: 0 },
    {
      id: 'g3',
      name: '公園',
      aliases: [],
      category: '場所',
      summary: '町外れ',
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  episodes: [
    {
      id: 'e',
      title: '',
      blocks: parseEpisodeBody(
        '○公園（夕方）\n\n\n風が吹く。No.1の看板。\n　　　　　字下げ済み\nユイ（声）「え！なに？」\n「うん」\n***\n○家',
      ),
    },
  ],
}

it('本文の行：柱は行頭で前に空行1つ、打った空行は1つに畳み、ト書きは3字下げに揃え、！？の後ろを空け、*** は ×　　×　　×', () => {
  expect(scriptBlocksToLines(work.episodes[0]?.blocks ?? [])).toEqual([
    '○公園（夕方）',
    '',
    `${S}${S}${S}風が吹く。Ｎｏ．１の看板。`,
    `${S}${S}${S}字下げ済み`,
    'ユイ（声）「え！　なに？」',
    '「うん」',
    '',
    `${S}${S}${S}×${S}${S}×${S}${S}×`,
    '',
    '○家',
  ])
})
it('前付け：表紙・登場人物表（用語集の人物と説明）・梗概（結末まで）を見出し付きで先頭に置く。あらすじ（読者向け）は載せない', () => {
  const text = workToScriptText(work)
  expect(
    text.startsWith(
      '月と剣\n著者\n\n\n登場人物表\n\nユイ　十七歳。　高校生。\nケン\n\n\n梗概\n\n　一行目。\n\n　結末まで。\n\n\n○公園（夕方）',
    ),
  ).toBe(true)
  expect(text).not.toContain('読者向けのあらすじ')
  expect(text).not.toContain('公園　町外れ')
  expect(text.endsWith('○家\n')).toBe(true)
})
it('前付けを外すと本文だけ。話が複数なら題名を見出しにして空行2つで区切る', () => {
  const src = sheetSourceOf({
    ...work,
    episodes: [
      { id: 'a', title: '第一話', blocks: parseEpisodeBody('風') },
      { id: 'b', title: '第二話', blocks: parseEpisodeBody('雨') },
    ],
  })
  expect(scriptToText(src, { cover: false, cast: false, synopsis: false })).toBe(
    `第一話\n\n${S}${S}${S}風\n\n\n第二話\n\n${S}${S}${S}雨\n`,
  )
})
