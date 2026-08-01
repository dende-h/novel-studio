import { useEffect } from 'react'

/**
 * ソフトキーボードが画面下から隠している高さを実測し、CSS 変数 --ns-kb-inset として
 * <html> に書く（use-preferences が --reading-font-size を書くのと同じ流儀）。
 *
 * なぜ必要か：iOS Safari はキーボード表示時にレイアウトビューポートを縮めない。
 * 100dvh も window.innerHeight も変わらないまま visual viewport だけがずれるため、
 * 画面下端に固定した要素（@サジェストのバー）がキーボードの裏に入ってしまう。
 *
 * Android Chrome はレイアウトごと縮むので、この式は自然に 0 付近を返す＝同じ式で両対応。
 */
const VAR = '--ns-kb-inset'

function measure(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  // 下端の隠れ量 = 全体の高さ −（見えている高さ ＋ 上へスクロールした量）。
  const inset = window.innerHeight - (vv.height + vv.offsetTop)
  // 端数やバウンス時の負値は 0 に丸める（キーボードが無い時は常に 0 にしたい）。
  return inset > 1 ? Math.round(inset) : 0
}

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const apply = () => {
      try {
        root.style.setProperty(VAR, `${measure()}px`)
      } catch {
        // 非 DOM 環境（テスト等）は no-op
      }
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      try {
        root.style.removeProperty(VAR)
      } catch {}
    }
  }, [])
}
