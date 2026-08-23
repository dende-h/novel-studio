import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { addEdge, addNode, emptyStructure, type Structure } from '../structure'
import { structuresToPlainText } from './structureToPlainText'

const work = (): Work => ({
  id: 'w1',
  title: '作品',
  episodes: [
    {
      id: 'ep1',
      title: '第一話',
      blocks: [{ id: 'b', type: 'paragraph', inlines: [{ type: 'text', text: 'あいう' }] }],
    },
  ],
  glossary: [
    { id: 'g1', name: '主人公', aliases: [], createdAt: 0, updatedAt: 0 },
    { id: 'g2', name: '師匠', aliases: [], createdAt: 0, updatedAt: 0 },
  ],
  updatedAt: 0,
})

describe('structuresToPlainText', () => {
  it('構造が無ければ案内文', () => {
    expect(structuresToPlainText([], work())).toContain('まだありません')
  })

  it('相関図：用語集名で解決し、関係ラベル付きで並べる', () => {
    let s = emptyStructure('c', 'w1', 'chart', 0)
    s = addNode(s, { id: 'a', kind: 'character', label: '', glossaryRef: 'g1' })
    s = addNode(s, { id: 'b', kind: 'character', label: '', glossaryRef: 'g2' })
    s = addEdge(s, { id: 'e', from: 'a', to: 'b', label: '師弟', kind: 'relation' })
    const out = structuresToPlainText([s], work())
    expect(out).toContain('【相関図】')
    expect(out).toContain('主人公 —（師弟）→ 師匠')
    expect(out).toContain('登場人物: 主人公、師匠')
  })

  it('アウトライン：話（字数）に構成メモを階層インデント付きで添える', () => {
    let s = emptyStructure('o', 'w1', 'outline', 0)
    s = addNode(s, { id: 'm', kind: 'note', label: '導入の伏線', episodeRef: 'ep1' })
    s = addNode(s, {
      id: 'm2',
      kind: 'note',
      label: '時計の描写',
      episodeRef: 'ep1',
      parentId: 'm',
    })
    const out = structuresToPlainText([s], work())
    expect(out).toContain('【アウトライン】')
    expect(out).toContain('1. 第一話（3字） [episode_id: ep1]') // set_outline に渡す id を明示
    expect(out).toContain('   - 導入の伏線')
    expect(out).toContain('      - 時計の描写') // 子は 1 段深く
  })

  it('マインドマップ：ツリーをインデントで表す', () => {
    let s = emptyStructure('m', 'w1', 'mindmap', 0, '発想')
    s = addNode(s, { id: 'r', kind: 'idea', label: '中心' })
    s = addNode(s, { id: 'c', kind: 'idea', label: '枝', parentId: 'r' })
    const out = structuresToPlainText([s], work())
    expect(out).toContain('【マインドマップ: 発想】')
    expect(out).toContain('- 中心')
    expect(out).toContain('  - 枝')
  })

  it('別作品の構造は除外される', () => {
    const other: Structure = {
      id: 'x',
      workId: 'w9',
      kind: 'chart',
      nodes: [],
      edges: [],
      updatedAt: 0,
    }
    expect(structuresToPlainText([other], work())).toContain('まだありません')
  })
})
