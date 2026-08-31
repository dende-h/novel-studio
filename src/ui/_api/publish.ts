import { buildNovelGameHtml } from '@/core/exporter/toNovelGame'
import type { Staging } from '@/core/game'
import type { UserGameAsset } from '@/core/game/assets'
import { publicTextOf } from '@/core/glossary'
import type { Episode, GlossaryEntry, Work, WorkPlatform } from '@/core/schema'

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

/**
 * 送信するバンドルの形式。platform 側と揃える。
 * v2 で work.platform、v3 で episodes[].visibility（話ごとの公開状態）、
 * v4 で episodes[].game（サウンドノベルの自己完結プレイヤー HTML）を追加。
 *
 * 使わない機能の版は名乗らない（**最小の版で送る**）。先方が新しい版を知らないあいだも
 * 「本文の更新だけは通る」ようにしておく（新しすぎるバンドルは 409 で弾かれる契約）。
 */
const SCHEMA_VERSION_WITH_GAME = 4
const SCHEMA_VERSION_WITH_EPISODES = 3
const SCHEMA_VERSION_BASE = 2

/**
 * プレイヤー HTML が参照するフォントの配信パス（コトノハ-grove- 側が同名で持つ契約 v4）。
 * HTML へ埋めると話ごとに MB 単位で太るため、フォントだけ配信側の静的ファイルを指す。
 */
export const GAME_FONT_HREF = '/game-assets/fonts/shippori-mincho-b1.woff2'

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
  /** 作者登録がまだ。公開ページはこの場に登録フォームを出す（先方へ飛ばさない） */
  needsAuthor?: boolean
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

/** 話ごとのサウンドノベル（契約 v4）。html は素材内包の自己完結プレイヤー。 */
export interface EpisodeGamePayload {
  v: 1
  html: string
}

/**
 * 送信する話。契約 v3 で `visibility`（話ごとの公開状態）、
 * v4 で `game`（サウンドノベルのプレイヤー HTML）を載せられるようになった。
 */
export type BundleEpisode = Episode & { visibility?: 'draft' | 'public'; game?: EpisodeGamePayload }

/** 契約 v4 でサウンドノベルを載せるときに渡す材料（作品ぶんの演出譜と手元の素材）。 */
export interface NovelGameBundleInput {
  stagings: Staging[]
  gameAssets: UserGameAsset[]
  /**
   * false ＝「サウンドノベルをやめた」の宣言。v4 は名乗るが game は 1 つも載せない
   * ＝先方が既存のプレイヤーを消す（v3 に落とすと旧クライアントと区別できず消せない）。
   * 省略は true。
   */
  enabled?: boolean
}

/** 送信する作品。ローカル専用キーを落とし、話に公開状態を載せた形。 */
export type BundleWork = Omit<Work, 'episodes' | 'platform'> & {
  episodes: BundleEpisode[]
  platform?: PlatformPayload
}

/**
 * 話ごとの公開状態を、送信する話の形（契約 v3 の `episodes[].visibility`）へ移す。
 *
 * 載せるのは**作品を公開するときだけ**。下書きのまま送る作品で話ごとの状態を宣言しても
 * 先方は効かせないし、こちらから「公開」と言い続ける理由も無い。
 * 記録の無い話は作品の公開状態（＝公開）に従うので、明示して全話ぶんの宣言にする
 * （契約は「1つでも載っていれば全話ぶんの宣言」＝部分更新はしない）。
 */
export function toBundleEpisodes(work: Work): { episodes: BundleEpisode[]; declared: boolean } {
  if (work.platform?.visibility !== 'public') {
    return { episodes: work.episodes, declared: false }
  }
  const byId = work.platform.episodeVisibility ?? {}
  return {
    episodes: work.episodes.map((ep) => ({ ...ep, visibility: byId[ep.id] ?? 'public' })),
    // 話が1つも無ければ何も宣言していないのと同じ（v2 のまま送る）
    declared: work.episodes.length > 0,
  }
}

/**
 * 契約 v4：公開する話にサウンドノベル（自己完結プレイヤー HTML）を添える。
 * 対象は **公開作品の公開話だけ**（下書きの話には作らない＝読者に出ない分で太らせない）。
 * 演出譜（Staging）が無い話も「演出ゼロでプレイできる」不変条件どおり成立する。
 * 1話でも載れば withGame ＝ schemaVersion 4 を名乗る。
 */
export function attachEpisodeGames(
  work: Work,
  episodes: BundleEpisode[],
  novelGame: NovelGameBundleInput,
): { episodes: BundleEpisode[]; withGame: boolean } {
  if (work.platform?.visibility !== 'public') return { episodes, withGame: false }
  // enabled: false は「やめた」の宣言＝v4 のまま game を載せない（先方が既存分を消す）
  if (novelGame.enabled === false) return { episodes, withGame: episodes.length > 0 }
  const stagingByEpisode = new Map(novelGame.stagings.map((s) => [s.episodeId, s]))
  let withGame = false
  const next = episodes.map((ep): BundleEpisode => {
    if (ep.visibility === 'draft') return ep
    const source = work.episodes.find((e) => e.id === ep.id)
    if (!source) return ep
    const html = buildNovelGameHtml(work, source, stagingByEpisode.get(ep.id), {
      fontHref: GAME_FONT_HREF,
      gameAssets: novelGame.gameAssets,
    })
    withGame = true
    return { ...ep, game: { v: 1, html } }
  })
  return { episodes: next, withGame }
}

/**
 * 送信する用語集を組み立てる。**作者メモ（authorNote）は必ず落とす**。
 *
 * 用語集そのものは読者に見せる前提で送っている（先方が初出の話まで読んだ読者に開く＝段階公開）。
 * その中で authorNote だけは「項目に紐づくが、まだ読者に見せない情報」の置き場なので、
 * ここで確実に取り除く。作品全体の設定・執筆の決め事はプロットの世界観設定側にあり、
 * プロットはそもそもこのバンドルに載らない。
 *
 * 公開情報は 1 欄（D-GLOS-PUBLIC-ONE）：ローカルに旧形式（summary + body）が残っていても、
 * ここで summary へ一本化して送る＝先方は summary だけ読めば公開情報の全文になる。
 */
function toBundleGlossary(glossary: GlossaryEntry[] | undefined): GlossaryEntry[] | undefined {
  if (!glossary) return undefined
  return glossary.map((entry) => {
    const { authorNote: _authorNote, body: _body, summary: _summary, ...rest } = entry
    const merged = publicTextOf(entry)
    return merged ? { ...rest, summary: merged } : rest
  })
}

/** 送信するバンドルの work を組み立てる（契約に無いローカル専用キーを落とす）。 */
export function toBundleWork(work: Work, novelGame?: NovelGameBundleInput): BundleWork {
  const { platform: _local, episodes: _episodes, glossary, ...rest } = work
  const payload = toPlatformPayload(work.platform)
  const sendable = toBundleGlossary(glossary)
  let episodes = toBundleEpisodes(work).episodes
  if (novelGame) episodes = attachEpisodeGames(work, episodes, novelGame).episodes
  const base: BundleWork = {
    ...rest,
    ...(sendable ? { glossary: sendable } : {}),
    episodes,
  }
  return payload ? { ...base, platform: payload } : base
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
  return '投稿は保存できましたが、この作品は コトノハ-grove- の運営が非表示にしているため公開できません。コトノハ-grove- の管理画面をご確認ください。'
}

/**
 * 作品を platform へ送る（work.platform に投稿設定を載せて渡す）。
 * novelGame を渡すと、公開する話へサウンドノベル（プレイヤー HTML）を添えて v4 で送る
 * （渡さなければ従来どおり v2/v3＝先方が v4 を知らなくても本文の更新は通る）。
 */
export async function publishWorkToPlatform(
  getToken: GetToken,
  work: Work,
  novelGame?: NovelGameBundleInput,
): Promise<PublishResult> {
  if (!PLATFORM_ORIGIN) {
    return { ok: false, message: '公開先が設定されていません' }
  }

  const jwt = await getToken()
  if (!jwt) {
    return { ok: false, message: '公開するにはサインインが必要です' }
  }

  const bundleWork = toBundleWork(work, novelGame)
  // 「やめた」の宣言（enabled: false）でも v4 を名乗る＝先方が既存プレイヤーを消せる
  const withGame =
    bundleWork.episodes.some((ep) => ep.game) ||
    (novelGame !== undefined && work.platform?.visibility === 'public' && work.episodes.length > 0)
  let res: Response
  try {
    res = await fetch(`${PLATFORM_ORIGIN}/api/import/kotonoha`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: withGame
          ? SCHEMA_VERSION_WITH_GAME
          : toBundleEpisodes(work).declared
            ? SCHEMA_VERSION_WITH_EPISODES
            : SCHEMA_VERSION_BASE,
        work: bundleWork,
      }),
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

  // 先方がまだ v4（サウンドノベル）を知らない版のときの案内（supported を添えて返る契約）
  if (payload.error === 'unsupported-schema-version') {
    return {
      ok: false,
      message:
        '公開先がまだサウンドノベル公開に対応していません。「サウンドノベル」を切ってから、もう一度お試しください。',
    }
  }
  const message = typeof payload.message === 'string' ? payload.message : defaultMessage(res.status)
  const registerUrl =
    typeof payload.registerUrl === 'string' ? `${PLATFORM_ORIGIN}${payload.registerUrl}` : undefined
  return {
    ok: false,
    message,
    registerUrl,
    ...(payload.error === 'not-author' ? { needsAuthor: true } : {}),
  }
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
