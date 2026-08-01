import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
// 日本語の本文用ウェブフォント（端末差をなくすためバンドル）。
// 縦書き／長文でフォールバック・メトリクスが崩れるのを防ぎ、どの端末でも同じ字形にする。
// unicode-range の subset 分割により、実配信は描画に必要な subset だけが遅延ロードされる。
import '@fontsource-variable/noto-sans-jp'
import '@fontsource-variable/noto-serif-jp'
// 見出し・作品タイトル用のディスプレイ明朝（デザインシステム指定）。本文プレビューは
// グリフ網羅性の高い Noto Serif JP のままにし、見出しだけ Shippori の字形を使う。
import '@fontsource/shippori-mincho-b1/500.css'
import '@fontsource/shippori-mincho-b1/600.css'
import '@fontsource/shippori-mincho-b1/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/auth-provider'
import { ErrorBoundary } from './components/ErrorBoundary/error-boundary'
import { ToastProvider } from './components/Toast/toast'
import { Root } from './Root'
import { createDefaultStore } from './store/createDefaultStore'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

// クラウドは自動同期ではなく明示バックアップ/復元モデル（Root の CloudBackupDialog）。
// ストアはローカル正本のみで、保存通知（同期トリガ）は持たない。
const store = createDefaultStore()

/**
 * 起動時に何かが落ちても白い画面で終わらせないための最後の砦。
 * 原稿は端末（IndexedDB）にあるので、まず「消えていない」ことを伝えて再読み込みへ導く。
 */
function StartupFailure({ retry }: { retry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center font-sans text-on-surface">
      <p className="text-base">画面を読み込めませんでした。</p>
      <p className="text-on-surface-variant text-sm">
        通信が途切れた可能性があります。書いた原稿はこの端末に保存されているので、
        もう一度読み込めばそのまま続けられます。
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-full border border-outline-variant/60 px-5 py-2.5 text-sm"
        >
          もう一度試す
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary px-5 py-2.5 text-on-primary text-sm"
        >
          再読み込み
        </button>
      </div>
    </div>
  )
}

// ここまで来た＝アプリの JS が届いた。index.html が置いた自動再読み込みの記録を落とす
// （次に取り損ねた時、また一度だけ取り直せるように）。
try {
  sessionStorage.removeItem('ns-boot-retry')
} catch {}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={(retry) => <StartupFailure retry={retry} />}>
      <AuthProvider>
        <ToastProvider>
          <Root store={store} />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
