import { useEffect } from 'react'
import { App } from './App'
import { LandingPage } from './components/LandingPage/landing-page'
import { useEditorStore } from './hooks/use-editor-store'
import { useHashRoute } from './hooks/use-hash-route'
import type { EditorStore } from './store/editorStore'

interface RootProps {
  store: EditorStore
}

/** 入り口（LP）とエディタをハッシュで切り替えるトップレベル Container。 */
export function Root({ store }: RootProps) {
  const { route, navigate } = useHashRoute()
  const { workList } = useEditorStore(store)

  // LP でも保存済み作品の有無を反映できるよう、入り口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  if (route === '/write') {
    return <App store={store} onExit={() => navigate('/')} />
  }
  return <LandingPage hasWorks={workList.length > 0} onStart={() => navigate('/write')} />
}
