/** テキストをクリップボードへコピーする（DOM 副作用の薄いラッパ）。成否を返す。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
