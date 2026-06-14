import { useEffect } from 'react'
import { App } from './App'
import { Library } from './components/Library/library'
import { useHashRoute } from './hooks/use-hash-route'
import type { EditorStore } from './store/editorStore'

interface RootProps {
  store: EditorStore
}

/** 入口（ライブラリ）とエディタをハッシュで切り替えるトップレベル Container。 */
export function Root({ store }: RootProps) {
  const { route, navigate } = useHashRoute()

  // ライブラリで保存済み作品一覧を表示するため、入口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  if (route === '/write') {
    return <App store={store} onExit={() => navigate('/')} />
  }
  return <Library store={store} onEnterEditor={() => navigate('/write')} />
}
