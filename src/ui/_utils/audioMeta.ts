import { bytesToDataUrl } from '@/core/image'

/**
 * 音声ファイル（運営テンプレの効果音）を送る前の下ごしらえ（DOM 依存）。
 * 変換はしない——mp3/m4a はそのまま送る（ブラウザに音声エンコーダは無い）。
 * （happy-dom は Audio/URL.createObjectURL 非対応のため unit テスト対象外。手動／実ブラウザで検証）
 */

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}

/**
 * 音声ファイルを data URL にする。MIME はファイル名の拡張子から決める
 * （OS によっては `file.type` が空や `audio/mp3` になり、サーバの受け付けと合わない）。
 * 受けられない拡張子（wav・ogg など）は null。
 */
export async function audioFileToDataUrl(file: File): Promise<string | null> {
  const ext = file.name.replace(/^.*\./, '').toLowerCase()
  const mime = AUDIO_MIME_BY_EXT[ext]
  if (!mime) return null
  return bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), mime)
}

/** 長さ（ミリ秒）。読めなければ reject（呼び出し側は長さ無しで送る）。 */
export function audioDurationMs(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  const audio = new Audio()
  audio.preload = 'metadata'
  return new Promise((resolve, reject) => {
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Math.round(audio.duration * 1000))
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('音声の長さを読めませんでした'))
    }
    audio.src = url
  })
}
