import { expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import { proofreadScript, speakerBaseName } from './proofread'

it('柱・話者つきセリフ・ト書きは字下げの数に関係なく通す', () => {
  const blocks = parseEpisodeBody(
    '○公園（夕方）\n風が吹く\n　看板に「禁止」とある\n　　　歩く\nユイ（声）「こんにちは」\n[[ケン]]『返事』',
  )
  const before = structuredClone(blocks)
  expect(proofreadScript(blocks)).toEqual([])
  expect(blocks).toEqual(before)
})
it('話者なしを確認候補にするが、字下げした鉤括弧はト書きとして扱う', () => {
  expect(proofreadScript(parseEpisodeBody('○公園\n「はい」\n　「禁止」の看板'))).toEqual([
    expect.objectContaining({ blockIndex: 1, code: 'missing-speaker' }),
  ])
})
it('空の柱・認識できない話者・括弧の不一致をそれぞれの行で知らせる', () => {
  expect(proofreadScript(parseEpisodeBody('○\nユイ ケン「声」\nユイ「未完\n【補足）'))).toEqual([
    expect.objectContaining({ blockIndex: 0, code: 'empty-slug' }),
    expect.objectContaining({ blockIndex: 1, code: 'unrecognized-speaker' }),
    expect.objectContaining({ blockIndex: 2, code: 'unclosed-bracket' }),
    expect.objectContaining({ blockIndex: 3, code: 'unclosed-bracket' }),
  ])
})
it('空の原稿では注意を出さず、柱のない原稿には候補を1つ出す', () => {
  expect(proofreadScript(parseEpisodeBody('\n　'))).toEqual([])
  expect(proofreadScript(parseEpisodeBody('\n風が吹く'))).toEqual([
    expect.objectContaining({ blockIndex: 1, code: 'missing-slug' }),
  ])
})

it('セリフ末尾の句点・算用数字・カメラワークの指示を知らせる', () => {
  expect(
    proofreadScript(parseEpisodeBody('○公園\nユイ「行くよ。」\n3人が歩く\nカメラがユイに寄る')),
  ).toEqual([
    expect.objectContaining({ blockIndex: 1, code: 'dialogue-period' }),
    expect.objectContaining({ blockIndex: 2, code: 'arabic-numeral' }),
    expect.objectContaining({ blockIndex: 3, code: 'camera-direction' }),
  ])
  // 「フライパン」「スタートアップ」のような普通の語は拾わない
  expect(
    proofreadScript(parseEpisodeBody('○台所\nフライパンを振る。スタートアップの話をする')),
  ).toEqual([])
})
it('登場人物表（用語集の人物）に無い話者を、話者ごとに1回だけ知らせる。補足は外して照合する', () => {
  const blocks = parseEpisodeBody(
    '○公園\nユイ（声）「はい」\nケン「やあ」\nケン「また」\n結衣「うん」',
  )
  expect(proofreadScript(blocks, { cast: ['ユイ', '結衣'] })).toEqual([
    expect.objectContaining({ blockIndex: 2, code: 'unknown-cast' }),
  ])
  // cast を渡さなければ確認しない
  expect(proofreadScript(blocks)).toEqual([])
  expect(speakerBaseName('ユイ（声）')).toBe('ユイ')
})
