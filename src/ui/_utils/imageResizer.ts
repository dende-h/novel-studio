import { fitWithin, squareCropRect } from '@/core/image'

/**
 * 画像ファイルをリサイズして JPEG の data URL にする DOM ユーティリティ。
 * 寸法計算は core/image の純関数に委ね、ここは canvas 描画（DOM 依存）だけを担う。
 * （happy-dom は canvas/createImageBitmap 非対応のため unit テスト対象外。手動／e2e で検証）
 */

const COVER_MAX_LONG_EDGE = 1400
const COVER_QUALITY = 0.85
const THUMB_SIZE = 256
const THUMB_QUALITY = 0.8

/** File を ImageBitmap か HTMLImageElement に読み込む（環境差を吸収）。 */
async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function dimsOf(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return img instanceof HTMLImageElement
    ? { w: img.naturalWidth, h: img.naturalHeight }
    : { w: img.width, h: img.height }
}

/** canvas に描いて JPEG data URL を返す（透過は白背景で平坦化）。 */
function toJpegDataUrl(
  draw: (ctx: CanvasRenderingContext2D) => void,
  outW: number,
  outH: number,
  quality: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できません')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  draw(ctx)
  return canvas.toDataURL('image/jpeg', quality)
}

/** 表紙：アスペクト比を維持して長辺 1400 にクランプ（拡大なし）→ JPEG data URL。 */
export async function coverToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file)
  const { w, h } = dimsOf(img)
  const fit = fitWithin(w, h, COVER_MAX_LONG_EDGE)
  return toJpegDataUrl(
    (ctx) => ctx.drawImage(img, 0, 0, fit.width, fit.height),
    fit.width,
    fit.height,
    COVER_QUALITY,
  )
}

const GAME_BG_MAX_LONG_EDGE = 1280
const GAME_BG_QUALITY = 0.82

/**
 * サウンドノベルの持ち込み背景：長辺 1280 にクランプ（拡大なし）→ WebP data URL。
 * WebP をエンコードできない環境（toDataURL が PNG へフォールバックする）では JPEG に落とす。
 * tone はカード共有・クロスフェードの下地に使う3色（上・中・下の帯の平均色）。
 */
export async function gameBgToDataUrl(
  file: File,
): Promise<{ dataUrl: string; tone: [string, string, string] }> {
  const img = await loadImage(file)
  const { w, h } = dimsOf(img)
  const fit = fitWithin(w, h, GAME_BG_MAX_LONG_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = fit.width
  canvas.height = fit.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できません')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, fit.width, fit.height)
  ctx.drawImage(img, 0, 0, fit.width, fit.height)

  let dataUrl = canvas.toDataURL('image/webp', GAME_BG_QUALITY)
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', GAME_BG_QUALITY)
  }

  // 上・中・下の3色：1×3 に縮めて各ピクセルの色を読む
  const toneCanvas = document.createElement('canvas')
  toneCanvas.width = 1
  toneCanvas.height = 3
  const toneCtx = toneCanvas.getContext('2d')
  if (!toneCtx) throw new Error('canvas 2d コンテキストを取得できません')
  toneCtx.drawImage(canvas, 0, 0, 1, 3)
  const px = toneCtx.getImageData(0, 0, 1, 3).data
  const hex = (i: number) =>
    `#${[px[i], px[i + 1], px[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`
  return { dataUrl, tone: [hex(0), hex(4), hex(8)] }
}

const GAME_SPRITE_MAX_LONG_EDGE = 1080
const GAME_SPRITE_QUALITY = 0.85

/**
 * サウンドノベルの立ち絵：長辺 1080 にクランプ（拡大なし）→ WebP data URL。
 * 背景と違い**透過を保つ**（白で塗らない）。WebP をエンコードできない環境は PNG に落とす
 * （JPEG は透過が消えるので使わない）。tone はスキーマ統一のため抽出するが立ち絵では未使用。
 */
export async function gameSpriteToDataUrl(
  file: File,
): Promise<{ dataUrl: string; tone: [string, string, string] }> {
  const img = await loadImage(file)
  const { w, h } = dimsOf(img)
  const fit = fitWithin(w, h, GAME_SPRITE_MAX_LONG_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = fit.width
  canvas.height = fit.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d コンテキストを取得できません')
  ctx.drawImage(img, 0, 0, fit.width, fit.height)

  let dataUrl = canvas.toDataURL('image/webp', GAME_SPRITE_QUALITY)
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/png')
  }

  const toneCanvas = document.createElement('canvas')
  toneCanvas.width = 1
  toneCanvas.height = 3
  const toneCtx = toneCanvas.getContext('2d')
  if (!toneCtx) throw new Error('canvas 2d コンテキストを取得できません')
  toneCtx.drawImage(canvas, 0, 0, 1, 3)
  const px = toneCtx.getImageData(0, 0, 1, 3).data
  const hex = (i: number) =>
    `#${[px[i], px[i + 1], px[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`
  return { dataUrl, tone: [hex(0), hex(4), hex(8)] }
}

/** 用語集サムネ：中央正方形クロップ 256×256（拡大なし）→ JPEG data URL。 */
export async function thumbnailToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file)
  const { w, h } = dimsOf(img)
  const c = squareCropRect(w, h, THUMB_SIZE)
  return toJpegDataUrl(
    (ctx) => ctx.drawImage(img, c.sx, c.sy, c.side, c.side, 0, 0, c.dSize, c.dSize),
    c.dSize,
    c.dSize,
    THUMB_QUALITY,
  )
}
