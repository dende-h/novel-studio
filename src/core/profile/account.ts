import type { Profile } from './index'

/**
 * ペンネームを「アカウントのもの」にするための判定（純ロジック・React も fetch も持たない）。
 *
 * ## なぜ要るか
 *
 * ペンネームは端末ローカル（IndexedDB の `profile` 1 行）にしか無かった。だから
 * **アカウントを切り替えても名前が変わらない**。別のアカウントでサインインしても、
 * ヘッダにもサイドバーにも新しい作品の著者にも前のアカウントの名前が出たままで、
 * 掲示板だけがサーバの表示名（`board_profiles.display_name`）を使う——同じ「ペンネーム」
 * という言葉で 2 つの違う値が動いていた。
 *
 * そこで**サーバに持っている表示名をアカウントの正本**とし、ローカルはその写しにする。
 * ローカルの行には「どのアカウントのものか」（`Profile.accountId`）を書いておき、
 * サインインのたびにこの関数で突き合わせる。
 *
 * ## 決めていること
 *
 * - **サーバに名前があれば、それに合わせる**（`adopt`）。改名も別端末での変更もこれで届く。
 * - **サーバに名前が無く、ローカルの名前が別のアカウントのものなら伏せる**（`clear`）。
 *   これがアカウント切り替えの本体。持ち越すと、他人の名前で書き込む事故になる。
 * - **サーバに名前が無く、ローカルの名前が誰のものでもないなら、そのまま残す**（`keep`）。
 *   サインイン前に決めた名前は、そのアカウントの候補として使ってもらう。
 *   **ここで勝手にサーバへ登録はしない。** 表示名は全体で一意（`name_key` の UNIQUE）で、
 *   黙って登録すると、同じ名前を使っていた別の人が先着で弾かれる。登録は本人が
 *   プロフィールを保存したときだけ（そのとき初めて公開の範囲も画面で伝わる）。
 * - **未サインインでは何もしない**（`keep`）。ローカルだけで書く人の名前を触らない。
 *
 * アバターには触れない（`penName` と `accountId` だけの判断）。アバターは公開されず、
 * 一意でもないので、アカウントで持ち替える理由がない。
 */
export type PenNameSync =
  /** 何もしない（サーバに合わせる必要がない） */
  | { action: 'keep' }
  /** サーバの表示名をローカルへ写す */
  | { action: 'adopt'; penName: string }
  /** 別のアカウントの名前なので伏せる */
  | { action: 'clear' }

export function penNameForAccount(input: {
  /** 端末に保存されているプロフィール */
  local: Pick<Profile, 'penName' | 'accountId'>
  /** サインイン中の Clerk userId（未サインインは null） */
  userId: string | null
  /** サーバが持っているこのアカウントの表示名（未登録は null／空文字） */
  serverName: string | null
}): PenNameSync {
  const { local, userId, serverName } = input
  if (userId === null) return { action: 'keep' }

  const server = (serverName ?? '').trim()
  if (server !== '') {
    // 既に同じ名前を同じアカウントで持っているなら書き込まない
    //（毎回の起動で updatedAt だけ進めると、端末間 LWW が無意味に揺れる）。
    if (local.penName === server && local.accountId === userId) return { action: 'keep' }
    return { action: 'adopt', penName: server }
  }

  // サーバに名前が無い。ローカルの名前が「別のアカウントのもの」なら伏せる。
  if (local.accountId !== undefined && local.accountId !== userId) return { action: 'clear' }
  return { action: 'keep' }
}
