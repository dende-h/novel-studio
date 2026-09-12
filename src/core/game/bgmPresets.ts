/**
 * 組み込みの BGM プリセット（24 曲・D-GAME-BGM-PRESETS）。
 *
 * 効果音（sePresets.ts）と違い、ここに**音の実体は無い**。あるのは「どんな場面に使う何という曲か」
 * という**枠**だけで、実音は運営が管理ページから同じ名前（`<slug>.mp3`）の曲を入れると
 * キーそのままに目録の実体へ差し替わる（`mergeBgmCatalog`）。曲が入るまでは
 * 演出エディタで選べるが鳴らない（「準備中」の印が付く）＝書き出しと投稿は未知キーと同じく読み飛ばす。
 *
 * 枠を先に切っておく理由：
 * - 演出譜が指すキー（`preset:bgm/<slug>`）を曲の制作より先に固定でき、曲を差し替えても
 *   作品側の参照が壊れない
 * - 管理ページに「入れるべきファイル名」が並ぶので、制作した曲の置き場所を迷わない
 * - 演出エディタで「どんな曲が揃うのか」を利用者に先に見せられる
 *
 * 命名は目録の規則（`bgm-<曲調>-<曲名>`・templates.ts の `parseTemplateFilename`）に従う。
 * 曲調の語（category）は一覧の分類タブになる：calm＝日常 / emotion＝感情 / tense＝緊張 / scene＝場面。
 * 制作用のプロンプトは docs/game/bgm-presets.md。
 */

export interface PresetBgm {
  /** アセットキー（Cue.bgm が指す）＝`preset:bgm/<slug>` */
  key: string
  /** ファイル名（拡張子なし）＝`bgm-<曲調>-<曲名>` */
  slug: string
  /** 一覧・クレジットに出す曲名 */
  label: string
  /** 曲調の語（一覧の分類） */
  category: string
  /** どんな場面に使うか（一覧の補足・管理ページの案内） */
  note: string
}

const DEFS: ReadonlyArray<Omit<PresetBgm, 'key'>> = [
  // 日常
  {
    slug: 'bgm-calm-bright',
    label: '日常・明るい',
    category: 'calm',
    note: '主人公の平常時。いちばん長く流れる曲',
  },
  { slug: 'bgm-calm-easy', label: '日常・のんびり', category: 'calm', note: '休日・雑談・食事' },
  { slug: 'bgm-calm-night', label: '日常・夜', category: 'calm', note: '帰り道・部屋・静かな会話' },
  { slug: 'bgm-calm-comedy', label: 'コメディ', category: 'calm', note: 'ボケ・ドタバタ' },
  // 感情
  {
    slug: 'bgm-emotion-warm',
    label: '温かい・ほのぼの',
    category: 'emotion',
    note: '交流・絆が深まる場面',
  },
  {
    slug: 'bgm-emotion-love',
    label: '恋愛・甘い',
    category: 'emotion',
    note: '二人きり・告白の前後',
  },
  {
    slug: 'bgm-emotion-bittersweet',
    label: '切ない',
    category: 'emotion',
    note: '別れ・すれ違い・回想',
  },
  { slug: 'bgm-emotion-sorrow', label: '悲しい', category: 'emotion', note: '死・喪失' },
  { slug: 'bgm-emotion-resolve', label: '決意・希望', category: 'emotion', note: '立ち直り・出発' },
  {
    slug: 'bgm-emotion-finale',
    label: '感動・大団円',
    category: 'emotion',
    note: 'クライマックス後の解決',
  },
  // 緊張
  { slug: 'bgm-tense-uneasy', label: '不穏', category: 'tense', note: '「何かおかしい」の前触れ' },
  {
    slug: 'bgm-tense-suspense',
    label: '緊迫・サスペンス',
    category: 'tense',
    note: '追跡・時間制限・対峙',
  },
  { slug: 'bgm-tense-battle-1', label: '戦闘1・激しい', category: 'tense', note: '敵との戦い' },
  {
    slug: 'bgm-tense-battle-2',
    label: '戦闘2・激しい',
    category: 'tense',
    note: '敵との戦い（別の曲）',
  },
  {
    slug: 'bgm-tense-battle-3',
    label: '戦闘3・信念',
    category: 'tense',
    note: '信念と信念のぶつかり合い。誇りと葛藤が半々',
  },
  {
    slug: 'bgm-tense-battle-4',
    label: '戦闘4・悲壮',
    category: 'tense',
    note: '勝ち目の薄い戦い。命を懸ける・散る覚悟',
  },
  { slug: 'bgm-tense-mystery', label: '謎・思索', category: 'tense', note: '推理・手がかりの整理' },
  {
    slug: 'bgm-tense-horror',
    label: '恐怖',
    category: 'tense',
    note: 'ホラー要素。じわじわ来る怖さ',
  },
  {
    slug: 'bgm-tense-dread',
    label: '恐怖・切迫',
    category: 'tense',
    note: '何かがすぐそこまで迫っている。逃げ場のない怖さ',
  },
  {
    slug: 'bgm-tense-creep',
    label: '恐怖・忍び寄る',
    category: 'tense',
    note: '足音が一歩ずつ近づいてくる怖さ。切迫の前段',
  },
  // 場面
  {
    slug: 'bgm-scene-sacred',
    label: '荘厳・神秘',
    category: 'scene',
    note: '儀式・超常・世界観の核心',
  },
  {
    slug: 'bgm-scene-memory',
    label: '回想・ノスタルジー',
    category: 'scene',
    note: '過去編・幼少期',
  },
  {
    slug: 'bgm-scene-hush',
    label: '静かな緊張',
    category: 'scene',
    note: '環境音の代わり。無音に近いが空白にならない',
  },
  {
    slug: 'bgm-scene-noir',
    label: 'ムーディ・夜の街',
    category: 'scene',
    note: 'バー・探偵事務所・大人の会話',
  },
]

export const PRESET_BGMS: readonly PresetBgm[] = DEFS.map((d) => ({
  key: `preset:bgm/${d.slug}`,
  ...d,
}))

/** 曲調の語 → 表示名（一覧の分類タブ。目録に表示名があればそちらが勝つ）。 */
export const PRESET_BGM_CATEGORY_LABELS: Record<string, string> = {
  calm: '日常',
  emotion: '感情',
  tense: '緊張',
  scene: '場面',
}

export function presetBgm(key: string): PresetBgm | undefined {
  return PRESET_BGMS.find((p) => p.key === key)
}

/** ファイル名（拡張子なし）から引く。管理ページの投入で表示名の既定に使う。 */
export function presetBgmBySlug(slug: string): PresetBgm | undefined {
  return PRESET_BGMS.find((p) => p.slug === slug)
}
