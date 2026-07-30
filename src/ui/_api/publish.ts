import type { Work } from '@/core/schema'

/**
 * novel platform への直接投稿クライアント。
 *
 * 認証は Clerk JWT（Bearer）。両アプリで同じ Clerk インスタンスを使うため
 * （執筆アカウント＝公開アカウント）、こちらのトークンをそのまま載せて呼べる。
 *
 * この機能は**無料アカウントでも使える**。課金の線は「配布」ではなく「保全」
 * （クラウド同期・版の履歴）側にある。
 *
 * 送信先は作品まるごと。再送すると platform 側で同じ作品へ完全上書きされるが、
 * 話は安定IDで突き合わせられるため、読者のいいね・投げ銭・コメントは保持される。
 */

type GetToken = () => Promise<string | null>

/** 送信するバンドルの形式。platform 側と揃える */
const SCHEMA_VERSION = 1

/** platform のベースURL。未設定なら投稿UIを出さない */
export const PLATFORM_ORIGIN: string | undefined = import.meta.env.VITE_PLATFORM_ORIGIN

export const isPublishAvailable = Boolean(PLATFORM_ORIGIN)

export type PublishSuccess = {
  ok: true
  created: boolean
  episodesUpserted: number
  episodesRemoved: number
  /** 取り込み後の確認先（platform の絶対URL） */
  manageUrl: string
}

export type PublishFailure = {
  ok: false
  /** UI にそのまま出せる日本語メッセージ */
  message: string
  /** 作者登録が必要なとき、その導線（platform の絶対URL） */
  registerUrl?: string
}

export type PublishResult = PublishSuccess | PublishFailure

/** 作品を platform へ送る */
export async function publishWorkToPlatform(getToken: GetToken, work: Work): Promise<PublishResult> {
  if (!PLATFORM_ORIGIN) {
    return { ok: false, message: '公開先が設定されていません' }
  }

  const jwt = await getToken()
  if (!jwt) {
    return { ok: false, message: '公開するにはサインインが必要です' }
  }

  let res: Response
  try {
    res = await fetch(`${PLATFORM_ORIGIN}/api/import/kotonoha`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, work }),
    })
  } catch {
    return { ok: false, message: '公開先に接続できませんでした。通信環境を確認してください' }
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch {
    // 本文が読めなくてもステータスから判断する
  }

  if (res.ok) {
    return {
      ok: true,
      created: payload.created === true,
      episodesUpserted: typeof payload.episodesUpserted === 'number' ? payload.episodesUpserted : 0,
      episodesRemoved: typeof payload.episodesRemoved === 'number' ? payload.episodesRemoved : 0,
      manageUrl: `${PLATFORM_ORIGIN}${typeof payload.manageUrl === 'string' ? payload.manageUrl : '/dashboard'}`,
    }
  }

  const message = typeof payload.message === 'string' ? payload.message : defaultMessage(res.status)
  const registerUrl =
    typeof payload.registerUrl === 'string' ? `${PLATFORM_ORIGIN}${payload.registerUrl}` : undefined
  return { ok: false, message, registerUrl }
}

function defaultMessage(status: number): string {
  if (status === 401) return '公開するにはサインインが必要です'
  if (status === 413) return '作品が大きすぎます。話を分けて送ってください'
  if (status === 503) return '公開先が一時的に利用できません。時間をおいて試してください'
  return '公開に失敗しました。時間をおいて試してください'
}
