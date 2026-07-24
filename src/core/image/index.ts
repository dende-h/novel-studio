/**
 * 画像処理の純ロジック（DOM 非依存）。
 * 寸法計算（リサイズ・クロップ）と data URL のデコードのみを扱い、
 * 実際の描画（canvas）は UI 層（src/ui/_utils/imageResizer.ts）に隔離する。
 */

export interface FitResult {
  width: number
  height: number
  /** 長辺が maxLongEdge を超えていた＝縮小が必要だったか。 */
  needsResize: boolean
}

/**
 * 表紙用：アスペクト比を維持したまま長辺を maxLongEdge にクランプする。
 * 拡大はしない（元が小さければ寸法そのまま・needsResize=false）。
 */
export function fitWithin(w: number, h: number, maxLongEdge: number): FitResult {
  const long = Math.max(w, h)
  if (long <= maxLongEdge) return { width: w, height: h, needsResize: false }
  const scale = maxLongEdge / long
  return { width: Math.round(w * scale), height: Math.round(h * scale), needsResize: true }
}

export interface CropRect {
  /** 元画像から切り出す正方形の左上座標。 */
  sx: number
  sy: number
  /** 切り出す正方形の一辺（元画像 px）。 */
  side: number
  /** 出力する正方形の一辺（拡大はしないので side 以下）。 */
  dSize: number
}

/**
 * 図鑑サムネ用：中央正方形クロップの矩形を求める。
 * side=min(w,h) を中央から切り出し、dSize=min(maxSize, side)（拡大しない）。
 */
export function squareCropRect(w: number, h: number, maxSize: number): CropRect {
  const side = Math.min(w, h)
  return {
    sx: Math.floor((w - side) / 2),
    sy: Math.floor((h - side) / 2),
    side,
    dSize: Math.min(maxSize, side),
  }
}

/**
 * "data:image/jpeg;base64,..." → "image/jpeg"。data URL でなければ null。
 */
export function dataUrlMime(dataUrl: string): string | null {
  const m = /^data:([^;,]+)/.exec(dataUrl)
  return m?.[1] ?? null
}

/**
 * base64 の data URL を Uint8Array にデコードする（EPUB 梱包用）。
 * base64 data URL でない／不正な場合は throw する。
 */
export function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !/;base64/i.test(dataUrl.slice(0, comma))) {
    throw new Error('base64 の data URL ではありません')
  }
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
