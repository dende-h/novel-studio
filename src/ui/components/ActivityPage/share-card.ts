import { buildHeatmap, type DailyActivity, type HeatCell, summarize } from '@/core/activity'

/**
 * 執筆の記録の共有カード（X 等へ投稿する PNG 画像）の生成。
 * 「今日◯字書いた・連続◯日」の報告は書き手の日常投稿の定番で、カードにアプリ名を
 * 添えることで利用者の投稿がそのまま紹介になる（広まる仕掛け）。
 * データ組み立ては純関数（テスト対象）、描画だけ Canvas に依存する。
 */

/** カードの寸法（X のタイムライン向け 1.91:1）。描画は 2 倍解像度で行う。 */
const WIDTH = 1200
const HEIGHT = 630
const SCALE = 2
/** 草グリッドの週数（約 4 か月・カード幅に収まる量）。 */
const GRASS_WEEKS = 17

/** カードに載せる数値と草（描画から分離した純データ）。 */
export interface ShareCardData {
  /** 今日の純増減（字）。 */
  todayChars: number
  /** 連続執筆日数。 */
  streak: number
  /** 通算の純増減（字）。 */
  totalNet: number
  /** 直近の草（GRASS_WEEKS 週 × 7 日）。 */
  heatmap: HeatCell[][]
  /** 表示日付（例: 2026年8月18日）。 */
  dateLabel: string
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

/** 日別レコードから共有カードのデータを組み立てる（純関数）。 */
export function buildShareCardData(
  days: readonly DailyActivity[],
  todayKey: string,
): ShareCardData {
  const s = summarize(days, todayKey)
  const netByDate = new Map(days.map((d) => [d.date, d.net]))
  const [y, m, d] = todayKey.split('-').map(Number)
  return {
    todayChars: s.today,
    streak: s.streak,
    totalNet: s.totalNet,
    heatmap: buildHeatmap(netByDate, todayKey, GRASS_WEEKS),
    dateLabel: `${y}年${m}月${d}日`,
  }
}

/** 画像に添える投稿文（Web Share / クリップボード用）。 */
export function shareCardText(data: Pick<ShareCardData, 'todayChars' | 'streak'>): string {
  const head =
    data.todayChars > 0
      ? `今日は ${fmt(data.todayChars)}字 書きました${data.streak > 1 ? `（連続${data.streak}日）` : ''}`
      : data.streak > 0
        ? `連続${data.streak}日、書いています`
        : '執筆の記録'
  return `${head} #コトノハleaf\n縦書き小説エディタ コトノハ-leaf- https://cotonoha-leaf.org`
}

/** 草の濃さ→色（アプリの forest トークンのライト値と揃える）。 */
const LEVEL_COLOR: Record<HeatCell['level'], string> = {
  0: '#eceae5',
  1: '#e3ece1',
  2: '#6b9660',
  3: '#2c5b27',
  4: '#1a3014',
}

const SERIF = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif'
const SANS = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif'

/**
 * 共有カードを PNG Blob として描く。Canvas が使えない環境では null。
 * フォントは読み込み完了を待ってから描く（未ロードだと代替フォントで焼き付くため）。
 */
export async function renderShareCard(data: ShareCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  canvas.height = HEIGHT * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    await document.fonts?.ready
  } catch {
    // フォント API が無い環境でも描画は続ける（代替フォント）
  }
  ctx.scale(SCALE, SCALE)

  // 紙の背景と枠
  ctx.fillStyle = '#fdfcfb'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.strokeStyle = 'rgba(157,163,174,0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(16, 16, WIDTH - 32, HEIGHT - 32)

  // 見出しと日付
  ctx.fillStyle = '#1f2430'
  ctx.font = `600 34px ${SERIF}`
  ctx.fillText('執筆の記録', 72, 108)
  ctx.fillStyle = '#6b7381'
  ctx.font = `400 22px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(data.dateLabel, WIDTH - 72, 104)
  ctx.textAlign = 'left'

  // 主役の数字：今日書いた文字（無ければ連続日数を主役に）
  const mainValue = data.todayChars > 0 ? fmt(data.todayChars) : `${data.streak}`
  const mainUnit = data.todayChars > 0 ? '字' : '日'
  const mainLabel = data.todayChars > 0 ? '今日書いた文字' : '連続執筆'
  ctx.fillStyle = '#6b7381'
  ctx.font = `500 24px ${SANS}`
  ctx.fillText(mainLabel, 72, 208)
  ctx.fillStyle = '#2c5b27'
  ctx.font = `700 120px ${SERIF}`
  ctx.fillText(mainValue, 72, 330)
  const w = ctx.measureText(mainValue).width
  ctx.font = `600 44px ${SERIF}`
  ctx.fillText(mainUnit, 72 + w + 16, 330)

  // 添えの数字：連続と通算
  ctx.fillStyle = '#4b5160'
  ctx.font = `500 26px ${SANS}`
  const sub =
    data.todayChars > 0
      ? `連続 ${data.streak} 日 ・ 通算 ${fmt(data.totalNet)} 字`
      : `通算 ${fmt(data.totalNet)} 字`
  ctx.fillText(sub, 72, 392)

  // 草（直近 GRASS_WEEKS 週・右側に 7 行 × 週数のグリッド）
  const cell = 24
  const gap = 6
  const gridW = data.heatmap.length * (cell + gap) - gap
  const gx = WIDTH - 72 - gridW
  const gy = 180
  ctx.fillStyle = '#6b7381'
  ctx.font = `500 20px ${SANS}`
  ctx.fillText(`直近 ${data.heatmap.length} 週間`, gx, gy - 18)
  for (let wi = 0; wi < data.heatmap.length; wi++) {
    const col = data.heatmap[wi] ?? []
    for (let di = 0; di < col.length; di++) {
      const c = col[di]
      if (!c || c.future) continue
      ctx.fillStyle = LEVEL_COLOR[c.level]
      ctx.fillRect(gx + wi * (cell + gap), gy + di * (cell + gap), cell, cell)
    }
  }

  // ブランドフッター
  ctx.fillStyle = '#1f2430'
  ctx.font = `700 30px ${SERIF}`
  ctx.fillText('コトノハ', 72, HEIGHT - 64)
  const bw = ctx.measureText('コトノハ').width
  ctx.fillStyle = '#92703f'
  ctx.font = `500 20px ${SERIF}`
  ctx.fillText('-leaf-', 72 + bw + 4, HEIGHT - 64)
  ctx.fillStyle = '#6b7381'
  ctx.font = `400 20px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText('cotonoha-leaf.org', WIDTH - 72, HEIGHT - 64)
  ctx.textAlign = 'left'

  if (typeof canvas.toBlob !== 'function') return null
  return await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
}
