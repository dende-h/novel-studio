/**
 * 運営テンプレ背景（8場所 × 3時間帯 = 24枚。D-GAME-ASSET-SOURCE）。
 *
 * G0 は手続き的なグラデーション SVG で場所と時間帯の「空気」を出す。生成AIの本画像
 * （WebP 1280×720）が揃ったら、キーはそのままに実体ファイルだけ差し替える計画
 * （キー設計が契約、絵は中身）。SVG は数 KB なので zip をほぼ太らせない。
 *
 * 素材の実体は正本 Work に埋めない（D-GAME-ASSET-STORE）。ここにあるのは
 * キーと生成規則だけで、zip へは書き出し時に必要な分だけ入る。
 */

export type GamePlace =
  | 'room'
  | 'hallway'
  | 'town'
  | 'nature'
  | 'road'
  | 'sky'
  | 'dark'
  | 'abstract'
export type GameTime = 'day' | 'dusk' | 'night'

export interface PresetBackground {
  /** アセットキー（Cue.bg / NovelGameOptions.defaultBg が指す） */
  key: string
  /** zip 内のファイル名（assets/bg/<slug>.svg） */
  slug: string
  label: string
  place: GamePlace
  time: GameTime
  /** 上・中・下の3色。共有カードの下地とクロスフェードの間の色にも使う */
  tone: [string, string, string]
}

// 場所の並び＝設計書のマトリクス順。「夜道」は昼夕の変種も持つため表記は「道」に寄せる。
const PLACES: Array<{ place: GamePlace; label: string }> = [
  { place: 'room', label: '室内' },
  { place: 'hallway', label: '廊下' },
  { place: 'town', label: '街' },
  { place: 'nature', label: '自然' },
  { place: 'road', label: '道' },
  { place: 'sky', label: '空' },
  { place: 'dark', label: '暗転' },
  { place: 'abstract', label: '抽象' },
]

const TIMES: Array<{ time: GameTime; label: string }> = [
  { time: 'day', label: '昼' },
  { time: 'dusk', label: '夕' },
  { time: 'night', label: '夜' },
]

const TONES: Record<GamePlace, Record<GameTime, [string, string, string]>> = {
  room: {
    day: ['#EFE6D6', '#E3D6BE', '#C6B598'],
    dusk: ['#E5C49A', '#C08A5E', '#7E5238'],
    night: ['#2B2D40', '#1F2132', '#131521'],
  },
  hallway: {
    day: ['#DDE2E9', '#C2C9D5', '#98A1B1'],
    dusk: ['#C8A88E', '#A07657', '#6A4B38'],
    night: ['#242A3C', '#1A1F2D', '#10131E'],
  },
  town: {
    day: ['#C6DBEA', '#E4EDF4', '#B6C3D0'],
    dusk: ['#5D4B74', '#C77A55', '#E5B06A'],
    night: ['#121A33', '#1C294A', '#2B3A5F'],
  },
  nature: {
    day: ['#BEE0F0', '#D9EDD5', '#7EA86B'],
    dusk: ['#6E5A82', '#D8A05F', '#5B6D45'],
    night: ['#101B2E', '#1B2B3D', '#22362F'],
  },
  road: {
    day: ['#C7D3DE', '#A8B4C1', '#6D7784'],
    dusk: ['#564260', '#8B5B4A', '#3D3944'],
    night: ['#0C1020', '#151A2C', '#1E2437'],
  },
  sky: {
    day: ['#AFD3F2', '#DBEDFB', '#F3FAFF'],
    dusk: ['#4A3C6E', '#C86F4A', '#F1C878'],
    night: ['#0B1230', '#1B2C55', '#2E4470'],
  },
  dark: {
    day: ['#26262B', '#1A1A1E', '#101013'],
    dusk: ['#241D22', '#171216', '#0D0A0C'],
    night: ['#14161F', '#0C0E15', '#05060A'],
  },
  abstract: {
    day: ['#E8EAF2', '#CBD4E8', '#A9B8D8'],
    dusk: ['#3E3654', '#7C5A6E', '#C08A6E'],
    night: ['#141A30', '#232B49', '#3A4568'],
  },
}

/** 光源（radial glow）の色。時間帯で決まる。 */
const GLOW_COLOR: Record<GameTime, string> = {
  day: '#FFFFFF',
  dusk: '#FFCF8A',
  night: '#BFD2F2',
}

/** 光源の位置と大きさ（viewBox 1280×720 に対する座標）。場所で決まる。 */
const GLOW_POS: Record<GamePlace, { cx: number; cy: number; r: number; opacity: number }> = {
  room: { cx: 980, cy: 300, r: 420, opacity: 0.35 },
  hallway: { cx: 640, cy: 330, r: 380, opacity: 0.28 },
  town: { cx: 900, cy: 250, r: 460, opacity: 0.3 },
  nature: { cx: 380, cy: 200, r: 460, opacity: 0.32 },
  road: { cx: 640, cy: 250, r: 400, opacity: 0.22 },
  sky: { cx: 940, cy: 190, r: 480, opacity: 0.45 },
  dark: { cx: 640, cy: 360, r: 520, opacity: 0.06 },
  abstract: { cx: 860, cy: 260, r: 500, opacity: 0.3 },
}

export const PRESET_BACKGROUNDS: PresetBackground[] = PLACES.flatMap(({ place, label }) =>
  TIMES.map(({ time, label: timeLabel }) => ({
    key: `preset:bg/${place}-${time}`,
    slug: `${place}-${time}`,
    label: `${label}（${timeLabel}）`,
    place,
    time,
    tone: TONES[place][time],
  })),
)

/** 演出未指定のときの既定背景。 */
export const DEFAULT_BG_KEY = 'preset:bg/abstract-night'

export function presetBackground(key: string): PresetBackground | undefined {
  return PRESET_BACKGROUNDS.find((p) => p.key === key)
}

/** 場所ごとのシルエット（薄い置き物）。絵ではなく気配を置く程度に留める。 */
function placeDeco(p: PresetBackground): string {
  const dim = 'rgba(0,0,0,.22)'
  const dimSoft = 'rgba(0,0,0,.14)'
  const lift = 'rgba(255,255,255,.20)'
  switch (p.place) {
    case 'room':
      // 床の帯と、窓明かりの矩形
      return (
        `<rect x="0" y="540" width="1280" height="180" fill="${dim}"/>` +
        `<rect x="880" y="150" width="230" height="330" rx="8" fill="${lift}" filter="url(#soft)"/>`
      )
    case 'hallway':
      // 奥へ収束する壁と床
      return (
        `<polygon points="0,0 0,720 420,520 420,240" fill="${dimSoft}"/>` +
        `<polygon points="1280,0 1280,720 860,520 860,240" fill="${dimSoft}"/>` +
        `<rect x="0" y="560" width="1280" height="160" fill="${dim}"/>`
      )
    case 'town':
      // ビルの稜線
      return (
        `<rect x="0" y="520" width="200" height="200" fill="${dim}"/>` +
        `<rect x="180" y="440" width="150" height="280" fill="${dim}"/>` +
        `<rect x="360" y="560" width="220" height="160" fill="${dim}"/>` +
        `<rect x="600" y="480" width="130" height="240" fill="${dim}"/>` +
        `<rect x="760" y="540" width="240" height="180" fill="${dim}"/>` +
        `<rect x="1030" y="470" width="250" height="250" fill="${dim}"/>`
      )
    case 'nature':
      // なだらかな丘
      return (
        `<ellipse cx="320" cy="760" rx="700" ry="220" fill="${dimSoft}"/>` +
        `<ellipse cx="1060" cy="800" rx="760" ry="260" fill="${dim}"/>`
      )
    case 'road':
      // 一本道（ぼかして気配だけ）と街灯の明かり
      return (
        `<polygon points="460,720 820,720 672,440 608,440" fill="${dimSoft}" filter="url(#soft)"/>` +
        `<circle cx="300" cy="330" r="60" fill="${GLOW_COLOR[p.time]}" opacity=".18" filter="url(#soft)"/>` +
        `<circle cx="980" cy="300" r="46" fill="${GLOW_COLOR[p.time]}" opacity=".14" filter="url(#soft)"/>`
      )
    case 'sky':
      // 雲の帯
      return (
        `<ellipse cx="380" cy="300" rx="420" ry="60" fill="${lift}" filter="url(#soft)"/>` +
        `<ellipse cx="900" cy="440" rx="500" ry="70" fill="${lift}" filter="url(#soft)" opacity=".6"/>`
      )
    case 'dark':
      return ''
    case 'abstract':
      // 大きな円と斜めの帯
      return (
        `<circle cx="320" cy="480" r="260" fill="${lift}" opacity=".35" filter="url(#soft)"/>` +
        `<polygon points="0,720 1280,300 1280,720" fill="${dimSoft}"/>`
      )
  }
}

/**
 * テンプレ背景の実体（SVG 文字列）。決定的（同じキーなら常に同じバイト列）。
 * プレイヤーは CSS 背景として敷き、Ken Burns（ゆっくりした寄り）をかける。
 */
export function presetBgSvg(p: PresetBackground): string {
  const [top, mid, bottom] = p.tone
  const glow = GLOW_POS[p.place]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${top}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${bottom}"/>
</linearGradient>
<radialGradient id="glow" cx="${(glow.cx / 1280).toFixed(3)}" cy="${(glow.cy / 720).toFixed(3)}" r="${(glow.r / 1280).toFixed(3)}">
<stop offset="0" stop-color="${GLOW_COLOR[p.time]}" stop-opacity="${glow.opacity}"/>
<stop offset="1" stop-color="${GLOW_COLOR[p.time]}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vig" cx=".5" cy=".42" r=".85">
<stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/>
</radialGradient>
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0"/></filter>
</defs>
<rect width="1280" height="720" fill="url(#base)"/>
${placeDeco(p)}
<rect width="1280" height="720" fill="url(#glow)"/>
<rect width="1280" height="720" fill="url(#vig)"/>
<rect width="1280" height="720" filter="url(#grain)"/>
</svg>
`
}

// ---------------------------------------------------------------------------
// クレジット（使用素材キーから機械的に生成する。07-novel-game.md §4.2）
// ---------------------------------------------------------------------------

export interface CreditLine {
  label: string
  body: string
}

/** 同梱フォントの表記（実体は @fontsource/shippori-mincho-b1。LICENSE 全文も zip に入れる）。 */
export const GAME_FONT_CREDIT =
  'しっぽり明朝 B1 — Copyright 2021 The Shippori Mincho Project Authors／SIL Open Font License 1.1'

/**
 * クレジット画面の行を、実際に同梱した素材から組み立てる。
 * 手書きの一覧を持たない＝素材と表記がずれない（不変条件）。
 */
export function buildGameCredits(opts: {
  bgLabels: string[]
  fontEmbedded: boolean
}): CreditLine[] {
  const lines: CreditLine[] = []
  if (opts.bgLabels.length > 0) {
    lines.push({
      label: '背景',
      body: `コトノハ 標準背景素材（${opts.bgLabels.join('・')}）`,
    })
  }
  if (opts.fontEmbedded) {
    lines.push({ label: 'フォント', body: GAME_FONT_CREDIT })
  }
  lines.push({ label: '制作ツール', body: 'コトノハ -leaf-（サウンドノベル書き出し）' })
  return lines
}
