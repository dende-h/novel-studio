import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'guest' | 'member'

export interface AuthState {
  /** Clerk が構成されているか（publishable key あり）。false の間は認証 UI を出さない。 */
  available: boolean
  status: AuthStatus
  /**
   * Clerk にサインイン済みか。`status === 'member'`（サインイン済み かつ 課金）とは別軸で、
   * 「サインイン済みだが未課金」（status は guest）を見分け、Root が全画面オンボーディング
   * （購読 or サインアウト）を出すのに使う。
   */
  isSignedIn: boolean
  userId: string | null
  /**
   * 解約後の復元猶予（epoch ms・未設定は null）。この時刻までは「復元のみ」可能で、以降クラウドの
   * データは削除される。status は member でなく guest のままだが、canRestore で復元導線を出す。
   */
  graceUntil: number | null
  /** 解約後の猶予期間内で「クラウドからの復元だけ」許可される状態か（member とは別軸）。 */
  canRestore: boolean
  /** 表示用の名前（Clerk のフルネーム／メール）。 */
  displayName: string | null
  openSignIn: () => void
  openSignUp: () => void
  signOut: () => void
  /** Clerk セッション JWT（同期 API 用）。未ログインは null。 */
  getToken: () => Promise<string | null>
}

/** プロバイダ未設定（=Clerk 無効）でも安全なゲスト既定。 */
export const GUEST_AUTH_STATE: AuthState = {
  available: false,
  status: 'guest',
  isSignedIn: false,
  userId: null,
  graceUntil: null,
  canRestore: false,
  displayName: null,
  openSignIn: () => {},
  openSignUp: () => {},
  signOut: () => {},
  getToken: async () => null,
}

export const AuthContext = createContext<AuthState | null>(null)

/** 認証状態を読む。プロバイダ未設定でもゲスト既定を返すので、どこからでも安全に呼べる。 */
export function useAuth(): AuthState {
  return useContext(AuthContext) ?? GUEST_AUTH_STATE
}
