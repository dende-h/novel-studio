import { useSyncExternalStore } from 'react'

/**
 * 狭い画面（スマートフォン相当）かどうか。use-hash-route と同型の useSyncExternalStore 実装。
 *
 * レイアウトの出し分けは原則 Tailwind の `max-lg:` / `lg:` で行い、このフックは使わないこと。
 * CSS だけでは解けない＝**React state を巻き戻す必要がある**箇所だけが利用者になる：
 *   1. 構造化3機能（アウトライン/相関図/マインドマップ）の入口ゲートと activeScreen リセット
 *      （広い画面で開いたまま縮めると、操作不能な画面に閉じ込められるため）
 *   2. @参照サジェストの形態切替（narrow は Enter を改行に返し、座標計算を行わない）
 */

/** Tailwind の lg（既定 1024px）と同値。index.css の @theme で上書きするなら必ずここも直すこと。 */
export const NARROW_MAX_PX = 1024

/** lg 未満 ＝ Tailwind の `max-lg:` と同じ範囲（0.02px 引くのは Tailwind の丸め規約に合わせるため）。 */
export const NARROW_QUERY = `(max-width: ${NARROW_MAX_PX - 0.02}px)`

function getMql(): MediaQueryList | null {
  try {
    return window.matchMedia?.(NARROW_QUERY) ?? null
  } catch {
    return null
  }
}

function subscribe(cb: () => void): () => void {
  const mql = getMql()
  if (!mql) return () => {}
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

const getSnapshot = (): boolean => getMql()?.matches ?? false

export function useIsNarrow(): boolean {
  // matchMedia が無い環境（SSR 等）は広い側に倒す＝機能を隠さない安全側。
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
