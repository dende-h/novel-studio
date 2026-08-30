import { PLATFORM_ORIGIN } from '@/ui/_api/publish'

/**
 * コトノハ-grove- （novel platform）の作者登録クライアント。
 *
 * 投稿には作者登録が要る。それを知るのが「書き終えて公開ボタンを押した瞬間」で、
 * しかも直し方が「別サイトを開いて登録し直す」だと、いちばんまずいところで手が止まる。
 * ここで登録まで済ませられるようにして、公開ページの中で完結させる。
 *
 * 認証は投稿と同じ Clerk セッションJWT（執筆アカウント＝公開アカウント）。
 * 契約は docs（platform 側 docs/architecture/kotonoha-import-contract.md）と揃える。
 */

type GetToken = () => Promise<string | null>

/** ペンネームの長さ（platform 側 profiles.display_name の制約と同じ）。 */
export const PEN_NAME_MAX = 40

export type AuthorStatus = {
  /** 作者登録が済んでいるか */
  isAuthor: boolean
  /** 停止中のアカウントか（投稿も登録もできない） */
  suspended: boolean
  /** 登録フォームの初期値（コトノハ-grove- の表示名） */
  penName: string
}

export type AuthorStatusResult =
  | { ok: true; status: AuthorStatus }
  /** 未サインイン・通信不能・未構成。公開ページは「まだ分からない」として扱う */
  | { ok: false; message: string }

export type RegisterAuthorResult = { ok: true; penName: string } | { ok: false; message: string }

/** 作者登録が済んでいるかを問い合わせる。投稿を試す前に伝えるために使う。 */
export async function fetchAuthorStatus(getToken: GetToken): Promise<AuthorStatusResult> {
  const jwt = await requireToken(getToken)
  if (typeof jwt !== 'string') return jwt

  let res: Response
  try {
    res = await fetch(`${PLATFORM_ORIGIN}/api/authors/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
  } catch {
    return { ok: false, message: '公開先に接続できませんでした。通信環境を確認してください' }
  }

  const payload = await readJson(res)
  if (!res.ok) {
    return { ok: false, message: messageOf(payload, '公開先の状態を取得できませんでした') }
  }
  return {
    ok: true,
    status: {
      isAuthor: payload.isAuthor === true,
      suspended: payload.suspended === true,
      penName: typeof payload.penName === 'string' ? payload.penName : '',
    },
  }
}

/** 作者登録する。ガイドライン同意はこの画面で取る（先方のモーダルと同じ条件）。 */
export async function registerAuthor(
  getToken: GetToken,
  input: { penName: string; authorBio?: string },
): Promise<RegisterAuthorResult> {
  const jwt = await requireToken(getToken)
  if (typeof jwt !== 'string') return jwt

  let res: Response
  try {
    res = await fetch(`${PLATFORM_ORIGIN}/api/authors/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        penName: input.penName,
        ...(input.authorBio?.trim() ? { authorBio: input.authorBio.trim() } : {}),
        agreedGuidelines: true,
      }),
    })
  } catch {
    return { ok: false, message: '公開先に接続できませんでした。通信環境を確認してください' }
  }

  const payload = await readJson(res)
  if (!res.ok) {
    return {
      ok: false,
      message: messageOf(payload, '作者登録に失敗しました。時間をおいて試してください'),
    }
  }
  return {
    ok: true,
    penName: typeof payload.penName === 'string' ? payload.penName : input.penName,
  }
}

/** 送信先とトークンが揃っているか。揃っていなければ、そのまま返せる失敗を返す。 */
async function requireToken(getToken: GetToken): Promise<string | { ok: false; message: string }> {
  if (!PLATFORM_ORIGIN) {
    return { ok: false, message: '公開先が設定されていません' }
  }
  const jwt = await getToken()
  if (!jwt) {
    return { ok: false, message: 'コトノハ-grove- を使うにはサインインが必要です' }
  }
  return jwt
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    // 本文が読めなくてもステータスから判断する
    return {}
  }
}

function messageOf(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.message === 'string' ? payload.message : fallback
}
