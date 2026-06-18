import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { folderToWork, workToFolder } from '.'

const work: Work = {
  id: 'w1',
  title: '夜の物語',
  episodes: [
    {
      id: 'e1',
      title: '第一話 出会い',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [
            { type: 'text', text: '私は' },
            { type: 'ruby', base: '漢字', reading: 'かんじ' },
          ],
        },
        { id: 'b2', type: 'paragraph', inlines: [] },
        { id: 'b3', type: 'paragraph', inlines: [{ type: 'emphasisDots', text: '重要' }] },
        { id: 'b4', type: 'sceneBreak' },
      ],
    },
    {
      id: 'e2',
      title: '第二話',
      blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '終わり' }] }],
    },
  ],
}

describe('folder（話ごとテキスト往復・外部Claude編集の橋）', () => {
  it('workToFolder は manifest と話ごと .txt を出力', () => {
    const files = workToFolder(work)
    const paths = files.map((f) => f.path).sort()
    expect(paths).toContain('manifest.json')
    expect(files.filter((f) => f.path.endsWith('.txt'))).toHaveLength(2)
  })

  it('話 .txt の中身はカクヨム記法本文', () => {
    const files = workToFolder(work)
    const ep1 = files.find((f) => f.path !== 'manifest.json' && f.content.includes('漢字'))
    expect(ep1?.content).toContain('私は漢字《かんじ》')
    expect(ep1?.content).toContain('《《重要》》')
    expect(ep1?.content).toContain('＊')
  })

  it('manifest は作品 id/title と話の対応を持つ', () => {
    const manifest = workToFolder(work).find((f) => f.path === 'manifest.json')!
    const parsed = JSON.parse(manifest.content)
    expect(parsed.id).toBe('w1')
    expect(parsed.title).toBe('夜の物語')
    expect(parsed.episodes).toHaveLength(2)
  })

  it('workToFolder → folderToWork で恒等（傍点もカクヨムでロスレス）', () => {
    expect(folderToWork(workToFolder(work))).toEqual(work)
  })

  it('folderToWork は .txt 本文を再パースして blocks を復元', () => {
    const restored = folderToWork(workToFolder(work))
    expect(restored.episodes[0]!.blocks.some((b) => b.type === 'sceneBreak')).toBe(true)
  })

  // ── @参照 / 辞書の往復（P1） ──
  const glossaryWork: Work = {
    id: 'w2',
    title: '辞書つき',
    episodes: [
      {
        id: 'e1',
        title: '第一話',
        blocks: [
          {
            id: 'b1',
            type: 'paragraph',
            inlines: [
              { type: 'text', text: '私は' },
              { type: 'ref', name: 'アリス' },
              { type: 'text', text: 'に会った' },
            ],
          },
        ],
      },
    ],
    glossary: [
      {
        id: 'g1',
        name: 'アリス',
        aliases: ['アリ'],
        category: '人物',
        reading: 'ありす',
        summary: '主人公',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  }

  it('GFD1: folder 往復で Work.glossary が manifest 経由で完全復元', () => {
    expect(folderToWork(workToFolder(glossaryWork))).toEqual(glossaryWork)
  })

  it('GFD2: 本文 ref は .txt に [[名前]] のまま（degrade しない）', () => {
    const ep = workToFolder(glossaryWork).find((f) => f.path.endsWith('.txt'))
    expect(ep?.content).toBe('私は[[アリス]]に会った')
  })

  it('GFD3: folderToWork で [[名前]] が ref inline へ往復恒等', () => {
    const restored = folderToWork(workToFolder(glossaryWork))
    const block = restored.episodes[0]!.blocks[0]
    expect(block?.type === 'paragraph' && block.inlines[1]).toEqual({ type: 'ref', name: 'アリス' })
  })
})
