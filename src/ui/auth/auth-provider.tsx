import { lazy, type ReactNode, Suspense } from 'react'
import { ErrorBoundary } from '@/ui/components/ErrorBoundary/error-boundary'
import { AuthContext, GUEST_AUTH_STATE } from './auth-context'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Clerk 一式は別チャンク。pk が設定された時だけ読み込む（ゲストのバンドルを軽く保つ）。
// 取得は一度だけ取り直す：LP から来た初回は cold load なので、電波の瞬断で落ちやすい。
const ClerkGate = lazy(() =>
  import('./clerk-gate').catch(
    () =>
      new Promise<typeof import('./clerk-gate')>((resolve, reject) =>
        setTimeout(() => import('./clerk-gate').then(resolve, reject), 700),
      ),
  ),
)

/**
 * 認証プロバイダ。publishable key があるときだけ Clerk を有効化する。
 * 無ければゲスト既定を流し込み、アプリは完全ローカルで動く（既存挙動と同一・既存テストも素通り）。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) {
    return <AuthContext.Provider value={GUEST_AUTH_STATE}>{children}</AuthContext.Provider>
  }
  // fallback には children を置かない。以前はゲスト版 children を fallback に描いていたが、
  // その場合 children は「fallback の木」と「ClerkGate の木」の二か所に現れ、Clerk チャンクが
  // 解決した瞬間に React が親を差し替えてサブツリー（Root）ごと再マウントする。結果、初回ダイアログの
  // 入場アニメが二度走って「一瞬二重に見える」ちらつきになっていた。fallback を null にして
  // children を ClerkGate 配下だけに置けば一度きりのマウントで済む。読み込み中は body の紙色
  // 背景（--background）が見えるだけで、チャンクがキャッシュ済みなら体感ほぼ即時。
  //
  // チャンクを取り切れなかったときはゲストとして先へ進める。ここで例外を通すと、
  // アプリ全体が消えて白い画面のまま操作できなくなる（LP からの初回遷移で踏みやすい）。
  // 原稿はローカル正本なので、サインインが無くても書く・読む・書き出すは成立する。
  // クラウドの導線だけが次の読み込みまで出なくなる（available:false ＝ 認証 UI 自体を出さない）。
  return (
    <ErrorBoundary
      fallback={() => (
        <AuthContext.Provider value={GUEST_AUTH_STATE}>{children}</AuthContext.Provider>
      )}
    >
      <Suspense fallback={null}>
        <ClerkGate publishableKey={PUBLISHABLE_KEY}>{children}</ClerkGate>
      </Suspense>
    </ErrorBoundary>
  )
}
