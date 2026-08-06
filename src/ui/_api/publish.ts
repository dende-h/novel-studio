import type { Work, WorkPlatform } from '@/core/schema'

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
 * つまり「公開／下書きの切り替え」も、visibility だけ変えた再送で安全に行える。
 */

type GetToken = () => Promise<string | null>

/** 送信するバンドルの形式。platform 側と揃える（v2 で work.platform を追加） */
const SCHEMA_VERSION = 2

/** platform のベースURL。未設定なら投稿UIを出さない */
export const PLATFORM_ORIGIN: string | undefined = import.meta.env.VITE_PLATFORM_ORIGIN

export const isPublishAvailable = Boolean(PLATFORM_ORIGIN)

/** 取り込みは成功したが公開はされなかった理由（契約 v2）。 */
export type PublishBlockedReason = 'declarations-missing' | 'moderated'

/** 契約 v2 の `work.platform` に載せてよいキー。ここに無いものはローカル専用。 */
export type PlatformPayload = Pick<
  WorkPlatform,
  'genre' | 'tags' | 'declaredAllAges' | 'declaredOriginal' | 'visibility' | 'isCompleted' | 'kind'
>

export type PublishSuccess = {
  ok: true
  created: boolean
  episodesUpserted: number
  episodesRemoved: number
  /** 取り込み後の確認先（platform の絶対URL） */
  manageUrl: string
  /** いま公開状態か（v2）。誓約が欠けていれば取り込みは成功しても false になる。 */
  published: boolean
  /** 公開が阻まれた理由（v2）。阻まれていなければ null。 */
  publishBlocked: PublishBlockedReason | null
  /** 公開後に読者として開く先（v2・platform の絶対URL）。返らなければ undefined */
  workUrl?: string
}

export type PublishFailure = {
  ok: false
  /** UI にそのまま出せる日本語メッセージ */
  message: string
  /** 作者登録が必要なとき、その導線（platform の絶対URL） */
  registerUrl?: string
}

export type PublishResult = PublishSuccess | PublishFailure

/**
 * 契約に定義されたキーだけを取り出す。ローカル専用（lastPublishedAt / workUrl / manageUrl）を
 * 送っても先方に無視されるだけだが、契約外のものは出さないほうが取り決めの境界がはっきりする。
 * 中身が空なら undefined＝platform ごと省略し、v1 と同じ「公開状態を変えない」挙動に倒す。
 */
export function toPlatformPayload(platform: WorkPlatform | undefined): PlatformPayload | undefined {
  if (!platform) return undefined
  const { genre, tags, declaredAllAges, declaredOriginal, visibility, isCompleted, kind } = platform
  const payload: PlatformPayload = {
    ...(genre !== undefined ? { genre } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(declaredAllAges !== undefined ? { declaredAllAges } : {}),
    ...(declaredOriginal !== undefined ? { declaredOriginal } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(isCompleted !== undefined ? { isCompleted } : {}),
    ...(kind !== undefined ? { kind } : {}),
  }
  return Object.keys(payload).length > 0 ? payload : undefined
}

/** 送信するバンドルの work を組み立てる（契約に無いローカル専用キーを落とす）。 */
export function toBundleWork(work: Work): Work {
  const { platform: _local, ...rest } = work
  const payload = toPlatformPayload(work.platform)
  return payload ? { ...rest, platform: payload } : rest
}

/**
 * 「公開して投稿」を選べるか。誓約 2 つが揃っていることが条件で、これは platform 側の
 * DB 制約と同じ。揃わないまま public を送っても、取り込みは通るが公開はされない。
 */
export function canPublishPublicly(
  platform: Pick<WorkPlatform, 'declaredAllAges' | 'declaredOriginal'> | undefined,
): boolean {
  return platform?.declaredAllAges === true && platform?.declaredOriginal === true
}

/** 公開が阻まれた理由を、作者に「何が足りないか」が伝わる日本語にする。 */
export function describePublishBlocked(reason: PublishBlockedReason): string {
  if (reason === 'declarations-missing') {
    return '投稿は保存できましたが、まだ公開されていません。「全年齢向け」と「一次創作」の2つの誓約にチェックを入れて、もう一度「公開して投稿」してください。'
  }
  return '投稿は保存できましたが、この作品は公開サイトの運営が非表示にしているため公開できません。公開サイトの管理画面をご確認ください。'
}

/** 作品を platform へ送る（work.platform に投稿設定を載せて渡す） */
export async function publishWorkToPlatform(
  getToken: GetToken,
  work: Work,
): Promise<PublishResult> {
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
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, work: toBundleWork(work) }),
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
      published: payload.published === true,
      publishBlocked: toBlockedReason(payload.publishBlocked),
      // v1 の platform は workUrl を返さない。無ければキーごと持たない（公開ページ導線を出さない）。
      ...(typeof payload.workUrl === 'string'
        ? { workUrl: `${PLATFORM_ORIGIN}${payload.workUrl}` }
        : {}),
    }
  }

  const message = typeof payload.message === 'string' ? payload.message : defaultMessage(res.status)
  const registerUrl =
    typeof payload.registerUrl === 'string' ? `${PLATFORM_ORIGIN}${payload.registerUrl}` : undefined
  return { ok: false, message, registerUrl }
}

/** 知らない理由コードが増えても壊れないよう、契約で決まった 2 つ以外は「阻まれていない」に倒す。 */
function toBlockedReason(raw: unknown): PublishBlockedReason | null {
  return raw === 'declarations-missing' || raw === 'moderated' ? raw : null
}

function defaultMessage(status: number): string {
  if (status === 401) return '公開するにはサインインが必要です'
  if (status === 413) return '作品が大きすぎます。話を分けて送ってください'
  if (status === 503) return '公開先が一時的に利用できません。時間をおいて試してください'
  return '公開に失敗しました。時間をおいて試してください'
}
