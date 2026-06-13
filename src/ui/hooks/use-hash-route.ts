import { useCallback, useSyncExternalStore } from 'react'

/**
 * 依存ゼロの最小ハッシュルーティング。`#/` = LP、`#/write` = エディタ。
 * hashchange を購読し、location.hash を唯一の真実とする（リロードで現在地を保持）。
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

const getRoute = (): string => window.location.hash.replace(/^#/, '') || '/'

export interface HashRoute {
  route: string
  navigate: (to: string) => void
}

export function useHashRoute(): HashRoute {
  const route = useSyncExternalStore(subscribe, getRoute, () => '/')
  const navigate = useCallback((to: string) => {
    const target = to.startsWith('#') ? to : `#${to}`
    if (window.location.hash === target) return
    window.location.hash = to
    // 一部環境（happy-dom 等）は hash 設定で hashchange を発火しないため明示通知。
    // 実ブラウザでも値が変わった時のみで、重複しても route 不変なら no-op。
    window.dispatchEvent(new Event('hashchange'))
  }, [])
  return { route, navigate }
}
