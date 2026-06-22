import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
// 日本語の本文用ウェブフォント（端末差をなくすためバンドル）。
// 縦書き／長文でフォールバック・メトリクスが崩れるのを防ぎ、どの端末でも同じ字形にする。
// unicode-range の subset 分割により、実配信は描画に必要な subset だけが遅延ロードされる。
import '@fontsource-variable/noto-sans-jp'
import '@fontsource-variable/noto-serif-jp'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/auth-provider'
import { Root } from './Root'
import { createDefaultStore } from './store/createDefaultStore'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <Root store={createDefaultStore()} />
    </AuthProvider>
  </StrictMode>,
)
