import fontUrl from '@fontsource/shippori-mincho-b1/files/shippori-mincho-b1-japanese-500-normal.woff2'
import licenseText from '@fontsource/shippori-mincho-b1/LICENSE?raw'
import type { NovelGameFont } from '@/core/exporter/toNovelGame'

/**
 * サウンドノベル zip に同梱する明朝フォント（アプリ本体と同じ しっぽり明朝 B1・500）。
 * unicode-range 分割ではない日本語一体型 woff2（約 1.9MB）を Vite のアセットとして参照し、
 * 書き出し時に fetch して zip へ入れる。OFL のライセンス全文も一緒に同梱する（再配布の条件）。
 *
 * 取得に失敗しても書き出しは止めない——フォント無しの zip はシステムの明朝で動く。
 */
export async function loadGameFont(): Promise<NovelGameFont | undefined> {
  try {
    const res = await fetch(fontUrl)
    if (!res.ok) return undefined
    return { data: new Uint8Array(await res.arrayBuffer()), licenseText }
  } catch {
    return undefined
  }
}
/** data URL 化した同梱フォントの控え（プレビューを開くたびに作り直さない）。 */
let fontDataUrl: Promise<string | undefined> | null = null

/**
 * アプリ内プレビュー用に、同梱フォントを data URL で返す（1 セッション 1 回だけ作る）。
 *
 * プレビューの iframe は sandbox（同一オリジンを渡さない）で動かすので、
 * `/assets/…` のような**同じサイトの URL でもフォントは読めない**（CORS）。
 * 読めないと本番と違う書体で組まれ、行の折り返しがずれて見える——文字組は
 * このプレイヤーの一番の品質軸（D-GAME-QUALITY）なので、実体ごと渡す。
 */
export function loadGameFontDataUrl(): Promise<string | undefined> {
  if (!fontDataUrl) {
    fontDataUrl = loadGameFont().then((font) => {
      if (!font) return undefined
      let binary = ''
      // 一度に渡すと引数の上限に当たるので分割する（約 1.9MB）
      for (let i = 0; i < font.data.length; i += 0x8000) {
        binary += String.fromCharCode(...font.data.subarray(i, i + 0x8000))
      }
      return `data:font/woff2;base64,${btoa(binary)}`
    })
  }
  return fontDataUrl
}
