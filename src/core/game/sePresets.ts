/**
 * 運営テンプレ効果音（Web Audio 合成・8種）。素材ファイルを持たない——
 * ここにあるのは**レシピ（合成パラメータ）だけ**で、実音はアプリの試聴
 * （src/ui/_utils/sePlayer.ts）と書き出したプレイヤー（novelGamePlayer.ts の
 * 小型インタプリタ）が同じレシピから鳴らす。zip も公開バンドルも太らない。
 *
 * レシピの契約（両インタプリタ共通）:
 * - 各 step は 1 音源（オシレータ or ホワイトノイズ）＋任意のローパス＋
 *   エンベロープ（約15msのアタック → d 秒かけて指数減衰）
 * - f→f2 / lp→lp2 は d 秒かけた指数スイープ
 * - t は開始オフセット（秒）。全 step が並行にスケジュールされる
 */

export interface SeStep {
  /** 波形。'noise' はホワイトノイズ */
  w: 'sine' | 'triangle' | 'square' | 'noise'
  /** 周波数 Hz（noise では未使用） */
  f?: number
  /** 終了周波数（省略＝f のまま） */
  f2?: number
  /** 開始オフセット秒（省略＝0） */
  t?: number
  /** 長さ（秒） */
  d: number
  /** ピークゲイン 0..1（省略＝0.5） */
  g?: number
  /** ローパスのカットオフ Hz（省略＝フィルタなし） */
  lp?: number
  /** ローパス終了カットオフ（省略＝lp のまま） */
  lp2?: number
}

export interface PresetSe {
  /** アセットキー（Cue.se が指す） */
  key: string
  slug: string
  label: string
  steps: SeStep[]
}

const DEFS: Array<{ slug: string; label: string; steps: SeStep[] }> = [
  {
    slug: 'rain',
    label: '雨',
    steps: [
      { w: 'noise', d: 2.8, g: 0.2, lp: 2600, lp2: 1700 },
      { w: 'noise', d: 2.8, g: 0.1, lp: 700 },
    ],
  },
  {
    slug: 'wind',
    label: '風',
    steps: [
      { w: 'noise', d: 3.2, g: 0.26, lp: 260, lp2: 900 },
      { w: 'noise', t: 1.5, d: 1.9, g: 0.16, lp: 900, lp2: 260 },
    ],
  },
  {
    slug: 'thunder',
    label: '遠雷',
    steps: [
      { w: 'noise', d: 2.4, g: 0.7, lp: 220, lp2: 55 },
      { w: 'sine', f: 55, f2: 36, d: 2.4, g: 0.45 },
    ],
  },
  {
    slug: 'bell',
    label: '鐘',
    steps: [
      { w: 'sine', f: 392, f2: 386, d: 3.6, g: 0.42 },
      { w: 'sine', f: 1060, d: 2.4, g: 0.2 },
      { w: 'sine', f: 2120, d: 1.2, g: 0.1 },
    ],
  },
  {
    slug: 'chime',
    label: 'チャイム',
    steps: [
      { w: 'sine', f: 1319, d: 0.9, g: 0.26 },
      { w: 'sine', f: 1760, t: 0.13, d: 0.9, g: 0.26 },
      { w: 'sine', f: 2637, t: 0.26, d: 1.3, g: 0.2 },
    ],
  },
  {
    slug: 'knock',
    label: 'ノック',
    steps: [
      { w: 'noise', d: 0.09, g: 0.65, lp: 420 },
      { w: 'noise', t: 0.24, d: 0.09, g: 0.65, lp: 360 },
    ],
  },
  {
    slug: 'footsteps',
    label: '足音',
    steps: [
      { w: 'noise', d: 0.08, g: 0.45, lp: 240 },
      { w: 'noise', t: 0.44, d: 0.08, g: 0.42, lp: 200 },
      { w: 'noise', t: 0.88, d: 0.08, g: 0.45, lp: 240 },
      { w: 'noise', t: 1.32, d: 0.08, g: 0.42, lp: 200 },
    ],
  },
  {
    slug: 'heartbeat',
    label: '鼓動',
    steps: [
      { w: 'sine', f: 58, f2: 40, d: 0.13, g: 0.65 },
      { w: 'sine', f: 52, f2: 38, t: 0.24, d: 0.11, g: 0.45 },
      { w: 'sine', f: 58, f2: 40, t: 0.95, d: 0.13, g: 0.65 },
      { w: 'sine', f: 52, f2: 38, t: 1.19, d: 0.11, g: 0.45 },
    ],
  },
]

export const PRESET_SES: PresetSe[] = DEFS.map((d) => ({
  key: `preset:se/${d.slug}`,
  slug: d.slug,
  label: d.label,
  steps: d.steps,
}))

export function presetSe(key: string): PresetSe | undefined {
  return PRESET_SES.find((p) => p.key === key)
}

/**
 * 鳴らし方（省略＝1回）。
 * `'loop'` は**次の場面の切れ目か「止める」まで**鳴り続ける（1回ものは重ねて鳴らせる）。
 */
export type SeRepeat = 2 | 'loop'

/**
 * 「鳴っている音をここで止める」を表す予約キー（`Cue.se` に入る）。
 * ループを場面の途中で終わらせる唯一の手段——これが無いと、止めるために
 * 場面の切れ目を入れるしかなくなり、立ち絵まで下ろすことになる。
 */
export const SE_STOP = 'stop'

/** 効果音キーの表示名（予約キーと未知キーも言葉にする）。 */
export function seLabelOf(key: string): string {
  if (key === SE_STOP) return '止める'
  return presetSe(key)?.label ?? key
}

/** 1 レシピの総再生時間（秒）。試聴 UI の目安とテストの安全弁に使う。 */
export function seDuration(se: PresetSe): number {
  return se.steps.reduce((max, s) => Math.max(max, (s.t ?? 0) + s.d), 0)
}
