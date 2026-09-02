/**
 * 組み込みの効果音（Web Audio 合成・12 種）。素材ファイルを持たない——
 * ここにあるのは**レシピ（合成パラメータ）だけ**で、実音はアプリの試聴
 * （src/ui/_utils/sePlayer.ts）と書き出したプレイヤー（novelGamePlayer.ts の
 * 小型インタプリタ）が同じレシピから鳴らす。zip も公開バンドルも太らない。
 * 運営テンプレの目録に同じ slug の音声ファイルが入れば、キーはそのままに実体が
 * ファイルへ差し替わる（D-GAME-TEMPLATE-CMS）＝ここは控え。
 *
 * レシピの契約（両インタプリタ共通・**変えるときは必ず両方を揃える**）:
 * - 各 step は 1 音源（オシレータ か ノイズ 3 色）＋任意のフィルタ（ハイパス → バンドパス →
 *   ローパスの順）＋エンベロープ（a 秒で立ち上がり → s 秒保って → d 秒までに指数減衰）
 * - f→f2 / lp→lp2 / bp→bp2 は d 秒かけた指数スイープ
 * - mf/md は音量の揺らぎ（LFO）。風の息・雨の波に使う
 * - rv はリバーブ送り。1 回の schedule ごとに 1 つのコンボルバ（合成した部屋の残響）を作る
 * - t は開始オフセット（秒）。全 step が並行にスケジュールされる
 * - period はループの周期（秒）。レシピの長さより短くして重ねると継ぎ目が消える
 */

export interface SeStep {
  /** 波形。noise=ホワイト／pink=ピンク（雨・葉擦れ）／brown=ブラウン（雷・風の唸り・足音の胴） */
  w: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise' | 'pink' | 'brown'
  /** 周波数 Hz（ノイズでは未使用） */
  f?: number
  /** 終了周波数（省略＝f のまま） */
  f2?: number
  /** 開始オフセット秒（省略＝0） */
  t?: number
  /** 長さ（秒・立ち上がりと保持を含む全体） */
  d: number
  /** ピークゲイン 0..1（省略＝0.5） */
  g?: number
  /** 立ち上がり（秒・省略＝0.015） */
  a?: number
  /** ピークを保つ長さ（秒・省略＝0＝すぐ減衰）。環境音はこれで平らにする */
  s?: number
  /** ローパスのカットオフ Hz（省略＝フィルタなし） */
  lp?: number
  /** ローパス終了カットオフ（省略＝lp のまま） */
  lp2?: number
  /** ハイパスのカットオフ Hz（省略＝なし） */
  hp?: number
  /** バンドパスの中心 Hz（省略＝なし）。q は鋭さ（省略＝1） */
  bp?: number
  bp2?: number
  q?: number
  /** 音量の揺らぎ：周波数 Hz と深さ 0..1（両方あるときだけ効く） */
  mf?: number
  md?: number
  /** リバーブ送り 0..1（省略＝0） */
  rv?: number
}

export interface PresetSe {
  /** アセットキー（Cue.se が指す） */
  key: string
  slug: string
  label: string
  steps: SeStep[]
  /** ループの周期（秒）。省略＝レシピの長さ */
  period?: number
}

const DEFS: Array<{ slug: string; label: string; steps: SeStep[]; period?: number }> = [
  {
    // 雨：ピンクノイズの平らな床（高域を少し削る）＋屋根を打つ低い胴＋窓を打つ粒
    slug: 'rain',
    label: '雨',
    period: 3.4,
    steps: [
      { w: 'pink', d: 4.0, a: 0.6, s: 2.8, g: 0.3, hp: 900, lp: 6500, mf: 0.35, md: 0.12 },
      { w: 'pink', d: 4.0, a: 0.6, s: 2.8, g: 0.12, lp: 1200 },
      { w: 'noise', t: 0.35, d: 0.05, a: 0.003, g: 0.16, bp: 3200, q: 6 },
      { w: 'noise', t: 0.9, d: 0.04, a: 0.003, g: 0.12, bp: 4200, q: 6 },
      { w: 'noise', t: 1.7, d: 0.05, a: 0.003, g: 0.18, bp: 2600, q: 6 },
      { w: 'noise', t: 2.6, d: 0.04, a: 0.003, g: 0.14, bp: 3600, q: 6 },
      { w: 'noise', t: 3.1, d: 0.05, a: 0.003, g: 0.12, bp: 3000, q: 6 },
    ],
  },
  {
    // 風：低い唸り（ブラウン＋帯域スイープ＋息の揺らぎ）に、口笛のような細い層と葉擦れ
    slug: 'wind',
    label: '風',
    period: 4.3,
    steps: [
      { w: 'brown', d: 5.0, a: 1.0, s: 3.0, g: 0.5, bp: 220, bp2: 520, q: 1.2, mf: 0.13, md: 0.35 },
      {
        w: 'pink',
        d: 5.0,
        a: 1.2,
        s: 2.6,
        g: 0.16,
        bp: 900,
        bp2: 1600,
        q: 2.5,
        mf: 0.21,
        md: 0.45,
      },
      { w: 'pink', d: 5.0, a: 0.8, s: 3.2, g: 0.08, hp: 2500, lp: 7000, mf: 0.17, md: 0.3 },
    ],
  },
  {
    // 遠雷：薄い割れ目 → 低い転がり（ブラウンのローパス落とし）＋サブ → 二波目
    slug: 'thunder',
    label: '遠雷',
    steps: [
      { w: 'noise', d: 0.35, a: 0.005, g: 0.3, hp: 1200, lp: 5000, rv: 0.3 },
      { w: 'brown', d: 4.6, a: 0.05, s: 0.4, g: 0.9, lp: 320, lp2: 60, rv: 0.5 },
      { w: 'sine', f: 52, f2: 30, d: 3.2, a: 0.03, g: 0.5 },
      { w: 'brown', t: 1.1, d: 2.6, a: 0.3, s: 0.3, g: 0.45, lp: 180, lp2: 50, rv: 0.5 },
    ],
  },
  {
    // 鐘：教会の鐘の倍音列（ハム・プライム・ティアース・クイント・ノミナル）＋うなり＋打音
    slug: 'bell',
    label: '鐘',
    steps: [
      { w: 'noise', d: 0.04, a: 0.002, g: 0.3, bp: 2600, q: 3, rv: 0.3 },
      { w: 'sine', f: 196, d: 4.5, a: 0.005, g: 0.25, rv: 0.35 },
      { w: 'sine', f: 392, d: 4.0, a: 0.005, g: 0.4, rv: 0.35 },
      { w: 'sine', f: 393.5, d: 3.6, a: 0.005, g: 0.2, rv: 0.35 },
      { w: 'sine', f: 470, d: 2.8, a: 0.005, g: 0.22, rv: 0.3 },
      { w: 'sine', f: 588, d: 2.2, a: 0.005, g: 0.16, rv: 0.3 },
      { w: 'sine', f: 784, d: 1.8, a: 0.005, g: 0.14, rv: 0.3 },
      { w: 'sine', f: 1180, d: 1.0, a: 0.005, g: 0.08 },
    ],
  },
  {
    // チャイム：「ピン・ポーン」（E6 → C6）。それぞれ倍音 2 つと打音、残響
    slug: 'chime',
    label: 'チャイム',
    steps: [
      { w: 'noise', d: 0.02, a: 0.002, g: 0.15, bp: 4000, q: 2 },
      { w: 'sine', f: 1319, d: 1.2, a: 0.004, g: 0.3, rv: 0.25 },
      { w: 'sine', f: 2638, d: 0.5, a: 0.004, g: 0.08 },
      { w: 'sine', f: 3957, d: 0.25, a: 0.004, g: 0.04 },
      { w: 'noise', t: 0.42, d: 0.02, a: 0.002, g: 0.15, bp: 3600, q: 2 },
      { w: 'sine', f: 1047, t: 0.42, d: 1.8, a: 0.004, g: 0.32, rv: 0.3 },
      { w: 'sine', f: 2094, t: 0.42, d: 0.7, a: 0.004, g: 0.09 },
      { w: 'sine', f: 3141, t: 0.42, d: 0.3, a: 0.004, g: 0.04 },
    ],
  },
  {
    // ノック：拳の当たり（短いクリック）＋扉の胴（低い落ち）＋木の鳴り、2 回
    slug: 'knock',
    label: 'ノック',
    steps: [
      { w: 'noise', d: 0.025, a: 0.001, g: 0.5, bp: 600, q: 1.5, rv: 0.15 },
      { w: 'sine', f: 110, f2: 55, d: 0.09, a: 0.002, g: 0.7, rv: 0.18 },
      { w: 'brown', d: 0.06, a: 0.002, g: 0.4, lp: 300 },
      { w: 'noise', t: 0.22, d: 0.025, a: 0.001, g: 0.45, bp: 560, q: 1.5, rv: 0.15 },
      { w: 'sine', f: 104, f2: 52, t: 0.22, d: 0.09, a: 0.002, g: 0.65, rv: 0.18 },
      { w: 'brown', t: 0.22, d: 0.06, a: 0.002, g: 0.36, lp: 300 },
    ],
  },
  {
    // 足音：踵の胴（ブラウンの低い塊）＋靴底の擦れ、4 歩を少しずつ違えて
    slug: 'footsteps',
    label: '足音',
    steps: [
      { w: 'brown', d: 0.07, a: 0.003, g: 0.5, lp: 260, rv: 0.12 },
      { w: 'noise', t: 0.02, d: 0.05, a: 0.003, g: 0.18, bp: 1800, q: 1.2, rv: 0.1 },
      { w: 'brown', t: 0.48, d: 0.07, a: 0.003, g: 0.44, lp: 230, rv: 0.12 },
      { w: 'noise', t: 0.5, d: 0.05, a: 0.003, g: 0.15, bp: 2100, q: 1.2, rv: 0.1 },
      { w: 'brown', t: 1.0, d: 0.07, a: 0.003, g: 0.5, lp: 250, rv: 0.12 },
      { w: 'noise', t: 1.02, d: 0.05, a: 0.003, g: 0.17, bp: 1700, q: 1.2, rv: 0.1 },
      { w: 'brown', t: 1.5, d: 0.07, a: 0.003, g: 0.42, lp: 240, rv: 0.12 },
      { w: 'noise', t: 1.52, d: 0.05, a: 0.003, g: 0.14, bp: 2000, q: 1.2, rv: 0.1 },
    ],
  },
  {
    // 鼓動：「ドッ・クン」×2（60 拍/分）。低い正弦の落ちと、胸の胴のブラウン
    slug: 'heartbeat',
    label: '鼓動',
    steps: [
      { w: 'sine', f: 62, f2: 38, d: 0.14, a: 0.008, g: 0.7, lp: 220 },
      { w: 'brown', d: 0.1, a: 0.005, g: 0.35, lp: 140 },
      { w: 'sine', f: 55, f2: 34, t: 0.2, d: 0.12, a: 0.008, g: 0.5, lp: 200 },
      { w: 'brown', t: 0.2, d: 0.09, a: 0.005, g: 0.25, lp: 140 },
      { w: 'sine', f: 62, f2: 38, t: 1.0, d: 0.14, a: 0.008, g: 0.7, lp: 220 },
      { w: 'brown', t: 1.0, d: 0.1, a: 0.005, g: 0.35, lp: 140 },
      { w: 'sine', f: 55, f2: 34, t: 1.2, d: 0.12, a: 0.008, g: 0.5, lp: 200 },
      { w: 'brown', t: 1.2, d: 0.09, a: 0.005, g: 0.25, lp: 140 },
    ],
  },
  {
    // 波：寄せて（帯域が上がる）引く（下がる）ブラウンの大きな揺れと、砕ける泡の高域
    slug: 'wave',
    label: '波',
    period: 4.2,
    steps: [
      { w: 'brown', d: 5.0, a: 1.6, s: 1.2, g: 0.6, bp: 180, bp2: 700, q: 0.8 },
      { w: 'pink', t: 1.2, d: 3.4, a: 0.9, s: 0.8, g: 0.22, hp: 1500, lp: 6000 },
      { w: 'pink', t: 2.6, d: 2.4, a: 0.3, s: 0.2, g: 0.1, hp: 3000, lp: 8000 },
    ],
  },
  {
    // 時計：「チッ・タッ」（1 秒周期）。乾いた 2 種類のクリックに小さな木の胴
    slug: 'clock',
    label: '時計',
    steps: [
      { w: 'noise', d: 0.018, a: 0.001, g: 0.4, bp: 2400, q: 4, rv: 0.08 },
      { w: 'sine', f: 1800, f2: 900, d: 0.03, a: 0.001, g: 0.12 },
      { w: 'noise', t: 0.5, d: 0.018, a: 0.001, g: 0.32, bp: 1500, q: 4, rv: 0.08 },
      { w: 'sine', f: 1200, f2: 600, t: 0.5, d: 0.03, a: 0.001, g: 0.1 },
      { w: 'noise', t: 1.0, d: 0.018, a: 0.001, g: 0.4, bp: 2400, q: 4, rv: 0.08 },
      { w: 'sine', f: 1800, f2: 900, t: 1.0, d: 0.03, a: 0.001, g: 0.12 },
      { w: 'noise', t: 1.5, d: 0.018, a: 0.001, g: 0.32, bp: 1500, q: 4, rv: 0.08 },
      { w: 'sine', f: 1200, f2: 600, t: 1.5, d: 0.03, a: 0.001, g: 0.1 },
    ],
  },
  {
    // 扉：閉まる。ラッチの金属音 → 板の重い胴 → 部屋の残響
    slug: 'door',
    label: '扉',
    steps: [
      { w: 'noise', d: 0.03, a: 0.001, g: 0.45, bp: 3200, q: 2, rv: 0.25 },
      { w: 'sine', f: 90, f2: 40, d: 0.22, a: 0.003, g: 0.8, rv: 0.3 },
      { w: 'brown', d: 0.3, a: 0.003, g: 0.7, lp: 220, lp2: 90, rv: 0.35 },
      { w: 'noise', t: 0.05, d: 0.08, a: 0.002, g: 0.2, bp: 900, q: 1.2, rv: 0.25 },
    ],
  },
  {
    // ガラス：割れる。鋭い砕け（ハイパスのノイズ）＋不協和な高い倍音の粒＋残響
    slug: 'glass',
    label: 'ガラス',
    steps: [
      { w: 'noise', d: 0.12, a: 0.001, g: 0.55, hp: 3000, rv: 0.35 },
      { w: 'sine', f: 2140, f2: 2100, d: 0.5, a: 0.002, g: 0.16, rv: 0.4 },
      { w: 'sine', f: 3390, f2: 3300, d: 0.4, a: 0.002, g: 0.12, rv: 0.4 },
      { w: 'sine', f: 5220, f2: 5100, d: 0.3, a: 0.002, g: 0.09, rv: 0.4 },
      { w: 'sine', f: 7130, f2: 6900, d: 0.22, a: 0.002, g: 0.06, rv: 0.4 },
      { w: 'noise', t: 0.09, d: 0.25, a: 0.01, g: 0.2, hp: 4000, rv: 0.4 },
      { w: 'noise', t: 0.3, d: 0.06, a: 0.002, g: 0.12, bp: 6000, q: 5, rv: 0.4 },
      { w: 'noise', t: 0.44, d: 0.05, a: 0.002, g: 0.09, bp: 5000, q: 5, rv: 0.4 },
    ],
  },
]

export const PRESET_SES: PresetSe[] = DEFS.map((d) => ({
  key: `preset:se/${d.slug}`,
  slug: d.slug,
  label: d.label,
  steps: d.steps,
  ...(d.period !== undefined ? { period: d.period } : {}),
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
export function seDuration(se: Pick<PresetSe, 'steps'>): number {
  return se.steps.reduce((max, s) => Math.max(max, (s.t ?? 0) + s.d), 0)
}

/** ループの周期（秒）。レシピの `period` が無ければ総再生時間。 */
export function sePeriod(se: Pick<PresetSe, 'steps' | 'period'>): number {
  return Math.max(0.2, se.period ?? seDuration(se))
}
