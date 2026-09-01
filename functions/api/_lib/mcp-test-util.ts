import type { CloudBackup } from '../../../src/core/backup'
import type { Plot } from '../../../src/core/plot'
import type { Work } from '../../../src/core/schema'
import type { Structure } from '../../../src/core/structure'
import type { McpDeps } from './mcp-server'

/**
 * MCP のテスト用フィクスチャと fake deps。
 *
 * 読み取りの改修（索引・絞り込み・応答予算）は「既定の引数で呼んだときの出力が 1 バイトも
 * 変わらないこと」を守れて初めて安全なので、**旧データの形をひととおり含む 1 つの作品**を
 * ここに置き、ゴールデン（全文スナップショット）と機能テストの両方が同じ土台を使う。
 */

/** 旧 2 欄（summary＋body）・作者メモ・未分類など、実データに出る形を混ぜた用語集。 */
export const fixtureWork = (): Work => ({
  id: 'w1',
  title: '星のない空',
  author: '灯',
  description: '灯台守の少女が、消えた星を探しに行く話。',
  updatedAt: 10,
  episodes: [
    {
      id: 'e1',
      title: '第一話 灯台',
      blocks: [
        { id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '　夜が明けた。' }] },
        {
          id: 'b2',
          type: 'paragraph',
          inlines: [
            { type: 'ref', name: 'アカリ' },
            { type: 'text', text: 'は' },
            { type: 'ruby', base: '灯台', reading: 'とうだい' },
            { type: 'text', text: 'の階段をのぼる。' },
          ],
        },
      ],
    },
    {
      id: 'e2',
      title: '第二話 海',
      blocks: [
        {
          id: 'b3',
          type: 'paragraph',
          inlines: [
            { type: 'emphasisDots', text: '星が' },
            { type: 'text', text: '落ちてきた。' },
          ],
        },
      ],
    },
  ],
  glossary: [
    {
      id: 'g1',
      name: 'アカリ',
      aliases: ['灯の子'],
      category: '人物',
      reading: 'あかり',
      summary: '灯台守の少女。',
      authorNote: '実は星の欠片から生まれた。',
      createdAt: 1,
      updatedAt: 2,
    },
    {
      // 旧 2 欄レコード（summary と body が両方ある）。publicTextOf が結合して読み出す。
      id: 'g2',
      name: '灯台',
      aliases: [],
      category: '場所',
      summary: '岬の先に立つ古い灯台。',
      body: '百年前から光を絶やしたことがない。',
      createdAt: 1,
      updatedAt: 2,
    },
    {
      // 分類なし・公開情報なしの最小レコード。
      id: 'g3',
      name: '星狩り',
      aliases: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
})

export const fixturePlot = (): Plot => ({
  id: 'p1',
  workId: 'w1',
  title: '星のない空',
  premise: '星を失った世界で、少女が最後の光を灯す。',
  theme: '喪失と継承',
  sections: [
    { id: 's1', title: '第一幕 出発', note: '日常が壊れるまで。', beatIds: ['bt1', 'bt2'] },
    { id: 's2', title: '第二幕 航海', beatIds: ['bt3'] },
  ],
  beats: [
    {
      id: 'bt1',
      title: '灯台の朝',
      summary: 'アカリが空から星が消えたことに気づく。',
      note: '静かに始める。',
      povRef: 'g1',
      castRefs: ['g1'],
      placeRefs: ['g2'],
      timeLabel: '一日目の朝',
      lineRefs: ['ln1'],
      episodeRef: 'e1',
      status: 'done',
      targetLength: 5000,
    },
    {
      id: 'bt2',
      title: '訪問者',
      guide: 'ここで外の世界が入ってくる',
      castRefs: [],
      placeRefs: [],
      lineRefs: [],
      status: 'writing',
    },
    {
      id: 'bt3',
      title: '海へ',
      summary: '船を出す。',
      castRefs: ['g1'],
      placeRefs: [],
      lineRefs: [],
      status: 'idea',
      targetLength: 3000,
    },
  ],
  lines: [{ id: 'ln1', title: 'アカリの成長', note: '主線' }],
  foreshadows: [
    { id: 'f1', title: '灯台の光が一度だけ揺れる', note: '第一話の描写', plantBeatId: 'bt1' },
  ],
  secrets: [
    { id: 'sc1', title: 'アカリの出自', truth: '星の欠片から生まれた', revealBeatId: 'bt3' },
  ],
  world: [
    { id: 'wn1', slot: 'stage', body: '星の消えた海辺の町。時代は近代に近い。', updatedAt: 5 },
    {
      id: 'wn2',
      slot: 'style',
      body: '三人称一元視点。アカリの見たものだけを書く。',
      updatedAt: 5,
    },
    {
      id: 'wn3',
      slot: 'custom',
      title: '色の決め事',
      body: '青は喪失、金は継承を表す。',
      updatedAt: 5,
    },
  ],
  updatedAt: 10,
})

export const fixtureStructures = (): Structure[] => [
  {
    id: 'w1:outline',
    workId: 'w1',
    kind: 'outline',
    nodes: [
      { id: 'n1', kind: 'note', label: '星が消える', episodeRef: 'e1' },
      { id: 'n2', kind: 'note', label: '灯台の描写を厚く', episodeRef: 'e1', parentId: 'n1' },
      { id: 'n3', kind: 'note', label: '船出', episodeRef: 'e2' },
    ],
    edges: [],
    updatedAt: 6,
  },
  {
    id: 'w1:chart',
    workId: 'w1',
    kind: 'chart',
    nodes: [
      { id: 'c1', kind: 'character', label: 'アカリ', glossaryRef: 'g1' },
      { id: 'c2', kind: 'place', label: '灯台', glossaryRef: 'g2' },
    ],
    edges: [{ id: 'ed1', from: 'c1', to: 'c2', kind: 'relation', label: '守る' }],
    updatedAt: 6,
  },
]

/** 上のフィクスチャ一式を載せたライブスナップショット。 */
export const fixtureSnapshot = (): CloudBackup => ({
  version: 1,
  createdAt: 0,
  works: [fixtureWork()],
  trash: [],
  profile: {},
  activity: [],
  ideas: [],
  structures: fixtureStructures(),
  plots: [fixturePlot()],
})

/** 保存回数を数えられる fake deps（読み取りが書き込みに紛れていないかの検査に使う）。 */
export function makeReadDeps(
  snapshot: CloudBackup | null,
  limits?: McpDeps['limits'],
): { deps: McpDeps; saveCount: () => number } {
  let saves = 0
  const deps: McpDeps = {
    loadSnapshot: async () => snapshot,
    saveSnapshot: async () => {
      saves += 1
      return true
    },
    createBackup: async () => null,
    listBackups: async () => [],
    restoreBackup: async () => false,
    now: () => 100,
    genId: () => 'gen-1',
    ...(limits ? { limits } : {}),
  }
  return { deps, saveCount: () => saves }
}

/** tools/call の JSON-RPC メッセージ。 */
export const callMsg = (name: string, args?: Record<string, unknown>) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as const

export const resultText = (res: unknown): string =>
  (res as { result: { content: { text: string }[] } }).result.content[0]?.text ?? ''

export const resultIsError = (res: unknown): boolean =>
  (res as { result: { isError?: boolean } }).result.isError === true

export const resultStructured = (res: unknown): Record<string, unknown> | undefined =>
  (res as { result: { structuredContent?: Record<string, unknown> } }).result.structuredContent
