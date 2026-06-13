import type { ExportFile } from './exporters'

/** ブラウザでファイルダウンロードを発火する（DOM 副作用の薄いラッパ）。 */
export function triggerDownload({ filename, mime, data }: ExportFile): void {
  // Uint8Array<ArrayBufferLike> を ArrayBuffer 裏付けの新規配列へ写し BlobPart に適合させる
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data)
  const blob = new Blob([part], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** File を UTF-8 テキストとして読む（バンドル/フォルダ取り込み用）。 */
export function readFileText(file: File): Promise<string> {
  return file.text()
}
