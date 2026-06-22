import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'guest' | 'member'

export interface AuthState {
  /** Clerk が構成されているか（publishable key あり）。false の間は認証 UI を出さない。 */
  available: boolean
  status: AuthStatus
  userId: string | null
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
  userId: null,
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
