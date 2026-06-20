import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work } from '../schema'
import { blocksToPlainText, workToPlainText } from './toPlainText'

describe('blocksToPlainText', () => {
  it('ルビは 親文字（よみ）で読みを括弧添えする', () => {
    expect(blocksToPlainText(parseEpisodeBody('漢字《かんじ》'))).toBe('漢字（かんじ）')
  })

  it('傍点は素のテキストへ落とす（記法マークアップを持ち込まない）', () => {
    expect(blocksToPlainText(parseEpisodeBody('《《重要》》'))).toBe('重要')
  })

  it('@参照は名前のプレーンへ degrade する（辞書非依存）', () => {
    expect(blocksToPlainText(parseEpisodeBody('[[アリス]]'))).toBe('アリス')
  })

  it('空行・シーン区切り・混在行が保たれる', () => {
    const blocks = parseEpisodeBody(
      ['私は[[アリス]]と剣《つるぎ》を', '', '＊', '終わり'].join('\n'),
    )
    expect(blocksToPlainText(blocks)).toBe(
      ['私はアリスと剣（つるぎ）を', '', '＊', '終わり'].join('\n'),
    )
  })
})

describe('workToPlainText', () => {
  it('タイトル・著者・あらすじ・各話見出しを含む 1 ドキュメントになる', () => {
    const work: Work = {
      id: 'w1',
      title: '銀河の詩',
      author: '星野',
      description: 'あらすじ本文。',
      episodes: [
        { id: 'e1', title: '第一話', blocks: parseEpisodeBody('むかしむかし') },
        { id: 'e2', title: '第二話', blocks: parseEpisodeBody('つづく') },
      ],
    }
    expect(workToPlainText(work)).toBe(
      [
        '# 銀河の詩',
        '著者: 星野',
        '',
        'あらすじ本文。',
        '',
        '## 第一話',
        '',
        'むかしむかし',
        '',
        '## 第二話',
        '',
        'つづく',
      ].join('\n'),
    )
  })

  it('著者・あらすじが無くてもタイトルと本文が出る', () => {
    const work: Work = {
      id: 'w2',
      title: '無題',
      episodes: [{ id: 'e1', title: '本編', blocks: parseEpisodeBody('内容') }],
    }
    expect(workToPlainText(work)).toBe(['# 無題', '', '## 本編', '', '内容'].join('\n'))
  })
})
