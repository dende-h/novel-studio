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
