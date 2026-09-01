import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { GlossaryEntry, Work } from '../schema'
import {
  blocksToPlainText,
  episodeIndexToPlainText,
  glossaryEntryToPlainText,
  glossaryIndexToPlainText,
  glossaryToPlainText,
  workToPlainText,
} from './toPlainText'

function entry(over: Partial<GlossaryEntry> & { name: string }): GlossaryEntry {
  return { id: `g-${over.name}`, aliases: [], createdAt: 0, updatedAt: 0, ...over }
}

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

  it('ルビを重ねた @参照は読みも残す（AI に発音情報を渡す）', () => {
    expect(blocksToPlainText(parseEpisodeBody('[[剣《つるぎ》]]'))).toBe('剣（つるぎ）')
    expect(blocksToPlainText(parseEpisodeBody('[[《《言葉》》]]'))).toBe('言葉')
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

describe('glossaryToPlainText', () => {
  it('全フィールドを 見出し＋メタ＋要約＋本文 にまとめる', () => {
    const g = [
      entry({
        name: 'アリス',
        category: '人物',
        reading: 'ありす',
        aliases: ['アリスちゃん', 'A'],
        summary: '勇敢な少女。',
        body: '王国の南で生まれ育った。',
      }),
    ]
    expect(glossaryToPlainText(g)).toBe(
      [
        '# 用語集',
        '',
        '## アリス',
        '分類: 人物 ・ よみ: ありす ・ 別名: アリスちゃん, A',
        '',
        '勇敢な少女。',
        '',
        '王国の南で生まれ育った。',
      ].join('\n'),
    )
  })

  it('名前だけの項目は見出しのみ（空メタ行を出さない）', () => {
    expect(glossaryToPlainText([entry({ name: '謎の人物' })])).toBe(
      ['# 用語集', '', '## 謎の人物'].join('\n'),
    )
  })

  it('別名が空ならメタに「別名」を出さない', () => {
    expect(glossaryToPlainText([entry({ name: '王国', category: '地名' })])).toBe(
      ['# 用語集', '', '## 王国', '分類: 地名'].join('\n'),
    )
  })

  it('複数項目を 用語集見出しの下に連結する', () => {
    const g = [entry({ name: 'A', summary: 'a' }), entry({ name: 'B', summary: 'b' })]
    expect(glossaryToPlainText(g)).toBe(
      ['# 用語集', '', '## A', '', 'a', '', '## B', '', 'b'].join('\n'),
    )
  })

  it('空の用語集は空文字（コピー対象なし）', () => {
    expect(glossaryToPlainText([])).toBe('')
  })

  it('withIds を立てると見出しに entry_id を添える（MCP の更新/削除対象の指定用）', () => {
    expect(glossaryToPlainText([entry({ name: 'アリス', summary: 'a' })], { withIds: true })).toBe(
      ['# 用語集', '', '## アリス [entry_id: g-アリス]', '', 'a'].join('\n'),
    )
    // 既定（無料コピー導線）は ID を出さない。
    expect(glossaryToPlainText([entry({ name: 'アリス' })])).not.toContain('entry_id')
  })
})

describe('索引と 1 件取得（MCP の読み取り用）', () => {
  const alice = entry({
    name: 'アリス',
    category: '人物',
    reading: 'ありす',
    aliases: ['白兎'],
    summary: '主人公。',
    authorNote: '正体は…',
  })
  // 旧 2 欄レコード（summary＋body）。字数は publicTextOf 経由で数える。
  const lighthouse = entry({ name: '灯台', summary: '岬の灯台。', body: '百年前から。' })
  const entries: GlossaryEntry[] = [alice, lighthouse]

  it('索引は本文を含まず、旧 2 欄レコードでも字数が 0 にならない', () => {
    const text = glossaryIndexToPlainText(entries)
    expect(text).toContain(
      '- アリス [entry_id: g-アリス] ／ 分類: 人物 ／ よみ: ありす ／ 別名: 白兎 ／ 公開情報 4字 ／ 作者メモ 4字',
    )
    expect(text).not.toContain('主人公。')
    expect(text).not.toContain('正体は…')
    // 「岬の灯台。」＋空行＋「百年前から。」＝ 13 字。summary だけ数えると 5 字になってしまう。
    expect(text).toContain('公開情報 13字')
  })

  it('索引は空でも空文字を返さない', () => {
    expect(glossaryIndexToPlainText([])).toContain('該当する項目はありません')
  })

  it('1 件の整形は既定で entry_id を出さない（無料のコピー導線に内部 id を混ぜない）', () => {
    expect(glossaryEntryToPlainText(alice)).not.toContain('entry_id')
    expect(glossaryEntryToPlainText(alice, true)).toContain('[entry_id: g-アリス]')
    // 全量出力に出るブロックと 1 文字も違わない（索引経由でも欄が落ちない）。
    expect(glossaryToPlainText(entries, { withIds: true })).toContain(
      glossaryEntryToPlainText(alice, true),
    )
  })

  it('workToPlainText は episodeId でその話だけ返し、見出しの形は変えない', () => {
    const work: Work = {
      id: 'w1',
      title: '本',
      episodes: [
        { id: 'e1', title: '一話', blocks: parseEpisodeBody('あ') },
        { id: 'e2', title: '二話', blocks: parseEpisodeBody('い') },
      ],
    }
    expect(workToPlainText(work, { episodeId: 'e2' })).toBe('# 本\n\n## 二話\n\nい')
    expect(workToPlainText(work)).toContain('## 一話')
  })

  it('話の索引は本文を持たず、字数と episode_id を出す', () => {
    const work: Work = {
      id: 'w1',
      title: '本',
      episodes: [{ id: 'e1', title: '一話', blocks: parseEpisodeBody('あいう') }],
    }
    expect(episodeIndexToPlainText(work)).toBe('# 本（全 1 話）\n1. 一話（3字） [episode_id: e1]')
    expect(episodeIndexToPlainText({ ...work, episodes: [] })).toContain('まだ話がありません')
  })
})
