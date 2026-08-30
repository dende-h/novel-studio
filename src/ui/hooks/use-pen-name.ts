import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { penNameForAccount } from '@/core/profile/account'
import { fetchMe, setDisplayName } from '@/ui/_api/board'
import { useAuth } from '@/ui/auth/auth-context'
import type { EditorStore, ProfileInput } from '@/ui/store/editorStore'

/**
 * ペンネームを**アカウント 1 つにつき 1 つ**に揃えるための配線。
 *
 * ## 何が問題だったか
 *
 * 同じ「ペンネーム」という言葉で 3 つの違う値が動いていた。
 *   1. 端末ローカルの `Profile.penName`（サイドバー・新しい作品の著者）
 *   2. Clerk のフルネーム／メール（ヘッダに出ていた「サインアップで入れた名前」）
 *   3. 掲示板の表示名 `board_profiles.display_name`（サーバ・アカウントごと）
 * 1 は端末に貼り付いているので**アカウントを切り替えても変わらず**、2 は名乗るつもりの
 * ない本名やメールがヘッダに出る。3 だけが正しくアカウントに付いていた。
 *
 * ## どう揃えたか
 *
 * **サーバの表示名（3）をアカウントの正本**とし、ローカル（1）をその写しにする。
 * ヘッダもサイドバーも新しい作品の著者も、これまでどおり 1 を読むだけでよい
 *（読む側を書き換えずに、中身がアカウントに追随するようになる）。2 は表示から外す。
 *
 * - `useAccountPenNameSync` … サインインのたびにサーバと突き合わせる（判定は
 *   `src/core/profile/account.ts` の `penNameForAccount`）
 * - `useSaveProfile` … プロフィールの保存でサーバにも送る（重複などの失敗は画面に返す）
 * - `PenNameContext` … ヘッダのように store を持たない部品へ名前だけを配る
 */

// ---------------------------------------------------------------------------
// 配布（store を持たない部品へ）
// ---------------------------------------------------------------------------

/**
 * いま表示すべきペンネーム（未設定は空文字）。Root が store から詰める。
 *
 * **文字列 1 つだけを配る。** プロフィール全体を配ると、アバターを差し替えただけで
 * ヘッダまで描き直る。既定が空文字なので、Provider の外（テスト・ゲスト）でも安全に読める。
 */
export const PenNameContext = createContext<string>('')

export const usePenName = (): string => useContext(PenNameContext)

/**
 * プロフィール（ペンネーム・アバター）の編集を開く。既定は何もしない。
 *
 * ダイアログ本体は Root が 1 つだけ持つ。**表示名を変える場所を 1 か所に保つ**ためで、
 * 画面ごとに置くと「掲示板では変えられない」（実際そうなっていた）が生まれる。
 * ヘッダの名前・サイドバーのプロフィール欄は、どちらもこの口を叩くだけにする。
 */
export const ProfileEditContext = createContext<() => void>(() => {})

export const useOpenProfile = (): (() => void) => useContext(ProfileEditContext)

// ---------------------------------------------------------------------------
// サインイン時の突き合わせ
// ---------------------------------------------------------------------------

/**
 * サインインしたら、そのアカウントの表示名をローカルのペンネームへ写す。
 *
 * **アプリに 1 か所だけ置く**（Root）。画面ごとに呼ぶと、行き来のたびに同じ問い合わせが飛ぶ。
 * 失敗（通信断・未登録）は黙って諦める＝名前が取れないだけで、書く・読むは成立する。
 */
export function useAccountPenNameSync(store: EditorStore): void {
  const auth = useAuth()
  // Clerk の `getToken` は毎レンダー別の関数になりうる。依存に置くと問い合わせが止まらない。
  const getTokenRef = useRef(auth.getToken)
  getTokenRef.current = auth.getToken
  const getToken = useCallback(async () => await getTokenRef.current(), [])
  const userId = auth.isSignedIn ? auth.userId : null

  useEffect(() => {
    if (userId === null) return
    let cancelled = false
    void fetchMe(getToken).then((res) => {
      if (cancelled || !res.ok) return
      const decision = penNameForAccount({
        local: store.getSnapshot().profile,
        userId,
        serverName: res.data.profile?.displayName ?? null,
      })
      if (decision.action === 'adopt') void store.adoptPenName(decision.penName, userId)
      // 別アカウントの名前は伏せる。ここで消さないと、前の利用者の名前のまま書き込める。
      else if (decision.action === 'clear') void store.adoptPenName('', null)
    })
    return () => {
      cancelled = true
    }
  }, [userId, store, getToken])
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

/** プロフィール保存の結果。失敗は**そのまま画面に出せる日本語**（`boardErrorMessage` 由来）。 */
export type ProfileSaveResult = { ok: true } | { ok: false; message: string }

/**
 * プロフィールの保存。**サインイン中はサーバの表示名も同じ名前にする**。
 *
 * サーバが先で、ローカルは成功したときだけ書き換える。逆にすると、重複（409）で
 * 弾かれた名前が端末にだけ残り、掲示板と画面で違う名前が出る。
 *
 * 名前を空にしたときはサーバへ送らない（表示名は消す口を持たない＝過去の書き込みから
 * 名前が消えると、誰の発言か分からない会話が残る）。端末の表示だけが未設定に戻り、
 * 次のサインインでアカウントの名前を拾い直す。
 */
export function useSaveProfile(
  store: EditorStore,
): (input: ProfileInput) => Promise<ProfileSaveResult> {
  const auth = useAuth()
  const authRef = useRef(auth)
  authRef.current = auth
  const getToken = useCallback(async () => await authRef.current.getToken(), [])

  return useCallback(
    async (input: ProfileInput): Promise<ProfileSaveResult> => {
      const { isSignedIn, userId } = authRef.current
      const penName = input.penName.trim()

      if (!isSignedIn || penName === '') {
        await store.updateProfile({ ...input, accountId: null })
        return { ok: true }
      }

      const res = await setDisplayName(penName, getToken)
      if (!res.ok) return { ok: false, message: res.message }
      // サーバが正規化した名前（空白の畳み込み等）で保存する＝掲示板と画面で字面がずれない。
      await store.updateProfile({
        ...input,
        penName: res.data.me.profile?.displayName ?? penName,
        accountId: userId,
      })
      return { ok: true }
    },
    [store, getToken],
  )
}
