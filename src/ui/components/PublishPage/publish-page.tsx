import {
  BookText,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  MAX_DESCRIPTION_LENGTH,
  PLATFORM_GENRES,
  PLATFORM_MAX_TAG_LENGTH,
  PLATFORM_MAX_TAGS,
  type Work,
  type WorkPlatform,
} from '@/core/schema'
import { countEpisodeChars } from '@/core/stats'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { cn } from '@/lib/utils'
import { type AuthorStatus, fetchAuthorStatus } from '@/ui/_api/author'
import {
  canPublishPublicly,
  describePublishBlocked,
  hasStagingCues,
  type NovelGameBundleInput,
  novelGameEpisodeOf,
  PLATFORM_ORIGIN,
  type PublishResult,
  publishWorkToPlatform,
} from '@/ui/_api/publish'
import { triggerDownload } from '@/ui/_utils/download'
import { episodeKakuyomuExport, episodeNarouExport, workEpubExport } from '@/ui/_utils/exporters'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'
import { AuthorRegisterCard } from '@/ui/components/PublishPage/author-register-card'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { createAssetHostingApi, pullHostedAssets } from '@/ui/game/asset-hosting'

/** コトノハ-grove- 上での見え方。契約の `visibility` と同じ 2 値。 */
type Visibility = 'draft' | 'public'

/** 公開設定の保存内容（作品へ書き戻して、次に開いたときと再送に引き継ぐ）。 */
export interface PublishPersistValues {
  description: string
  platform: WorkPlatform
}

interface PublishPageProps {
  /** 公開する作品。null なら開く前（ライブラリから作品を選び直してもらう）。 */
  work: Work | null
  getToken: () => Promise<string | null>
  /** Clerk にサインイン済みか。未サインインなら投稿も作者登録もできない。 */
  isSignedIn: boolean
  onSignIn?: () => void
  /** 入力内容と投稿結果を作品へ保存する。 */
  onPersist: (workId: string, values: PublishPersistValues) => void
  /** 戻り先（既定は執筆画面）。 */
  backHref?: string
  backLabel?: string
  /** 演出譜の置き場所（渡されたときだけ「サウンドノベル」の切り替えが出る・契約 v4）。 */
  stagingRepo?: Pick<StagingRepository, 'listByWork'>
  /** ゲーム素材の置き場所（サウンドノベルの背景・立ち絵を同梱するのに使う）。 */
  gameAssetRepo?: Pick<GameAssetRepository, 'list' | 'save'>
}

/** 自由タグの入力（読点／カンマ／改行区切り）を配列へ。trim・空除去・重複除去。 */
export function parseTags(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,、\n]/)) {
    const t = part.trim()
    if (t !== '' && !out.includes(t)) out.push(t)
  }
  return out
}

/** タグが コトノハ-grove- の受け入れ条件に収まっているか。収まらなければ理由を返す。 */
export function validateTags(tags: string[]): string | null {
  if (tags.length > PLATFORM_MAX_TAGS) {
    return `タグは${PLATFORM_MAX_TAGS}件までです（いま${tags.length}件）`
  }
  if (tags.some((t) => t.length > PLATFORM_MAX_TAG_LENGTH)) {
    return `タグは1件あたり${PLATFORM_MAX_TAG_LENGTH}字までです`
  }
  return null
}

/** 話ごとの公開状態を引く。記録の無い話は作品の状態に従う（＝公開なら公開）。 */
export function episodeVisibilityOf(
  map: Record<string, Visibility> | undefined,
  episodeId: string,
  workVisibility: Visibility,
): Visibility {
  if (workVisibility !== 'public') return 'draft'
  return map?.[episodeId] ?? 'public'
}

/**
 * 公開ページ。作品ひとつぶんの「公開に関わること」を1枚にまとめる。
 *
 * 以前はダイアログで、押した瞬間に作品まるごとが飛んでいった。単話の話なのか作品全体の話なのか
 * が分からず、話ごとに伏せることもできなかった。ここでは
 * **全体を見渡してから、確認して、まとめて反映する**という順序にしている。
 *
 * 公開は取り消しの効かない行為なので、
 *   - 反映は「公開状態を更新」ボタン＋確認ダイアログを通ったときだけ
 *   - 話ごとの公開は、作品が公開のときだけ意味を持つ（作品が下書きなら触れない）
 * という線を引いている。
 */
export function PublishPage({
  work,
  getToken,
  isSignedIn,
  onSignIn,
  onPersist,
  backHref = '#/write',
  backLabel = '執筆画面へ戻る',
  stagingRepo,
  gameAssetRepo,
}: PublishPageProps) {
  const uid = useId()
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [isCompleted, setIsCompleted] = useState(false)
  const [kind, setKind] = useState<'serial' | 'oneshot'>('serial')
  const [allAges, setAllAges] = useState(false)
  const [original, setOriginal] = useState(false)
  const [visibility, setVisibility] = useState<Visibility>('draft')
  const [episodeVisibility, setEpisodeVisibility] = useState<Record<string, Visibility>>({})
  const [novelGame, setNovelGame] = useState(false)
  /** 話ごとのサウンドノベル（話ID → する / しない）。**ここに true がある話だけ**が対象 */
  const [novelGameEpisodes, setNovelGameEpisodes] = useState<Record<string, boolean>>({})
  /** 演出を付けてある話のID。選んだ話に演出がまだ無いことを知らせるのに使う */
  const [stagedEpisodeIds, setStagedEpisodeIds] = useState<Set<string>>(new Set())

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)

  /** コトノハ-grove- 側の作者登録の状態。null＝まだ分からない（取得中・未サインイン等）。 */
  const [author, setAuthor] = useState<AuthorStatus | null>(null)

  // 同期済みの作品ID。開いた作品が変わったときだけ入力を作り直すための目印
  // （投稿が成功すると work が差し替わる。毎回同期すると、出したばかりの結果と入力が飛ぶ）。
  const syncedId = useRef<string | null>(null)

  useEffect(() => {
    if (!work || syncedId.current === work.id) return
    syncedId.current = work.id
    const p = work.platform
    setDescription(work.description ?? '')
    setGenre(p?.genre ?? '')
    setTagsText((p?.tags ?? []).join('、'))
    setIsCompleted(p?.isCompleted ?? false)
    setKind(p?.kind ?? 'serial')
    setAllAges(p?.declaredAllAges === true)
    setOriginal(p?.declaredOriginal === true)
    setVisibility(p?.visibility === 'public' ? 'public' : 'draft')
    setEpisodeVisibility({ ...(p?.episodeVisibility ?? {}) })
    setNovelGame(p?.novelGame === true)
    setNovelGameEpisodes({ ...(p?.novelGameEpisodes ?? {}) })
    setResult(null)
  }, [work])

  // どの話に演出を付けてあるか。**選ぶ材料ではなく知らせる材料**——演出ゼロの話を
  // 選んでも公開はできる（文字だけで進む）ので、そうなっていることだけ伝える
  useEffect(() => {
    if (!work || !stagingRepo) return
    let alive = true
    void stagingRepo.listByWork(work.id).then((list) => {
      if (!alive) return
      setStagedEpisodeIds(new Set(list.filter(hasStagingCues).map((s) => s.episodeId)))
    })
    return () => {
      alive = false
    }
  }, [work, stagingRepo])

  // 作者登録が済んでいるかを先に確かめる。投稿を試して 403 で知る作りにはしない。
  useEffect(() => {
    if (!isSignedIn) {
      setAuthor(null)
      return
    }
    let alive = true
    void fetchAuthorStatus(getToken).then((res) => {
      if (alive) setAuthor(res.ok ? res.status : null)
    })
    return () => {
      alive = false
    }
  }, [isSignedIn, getToken])

  const episodes = work?.episodes ?? []
  const tags = parseTags(tagsText)
  const tagError = validateTags(tags)
  const declarationsOk = canPublishPublicly({
    declaredAllAges: allAges,
    declaredOriginal: original,
  })
  /** 公開に倒したいのに誓約が足りない。押させずに理由を出す。 */
  const blockedByDeclarations = visibility === 'public' && !declarationsOk
  const needsAuthor = isSignedIn && author !== null && !author.isAuthor
  // コトノハ-grove- に出る作者名。**投稿バンドルの著者名は使われない**——コトノハ-grove- は
  // 登録済みのペンネーム（platform の profiles.display_name）を常に優先する。
  // 取れていないとき（未サインイン・通信断）は空文字＝名前の話をしない。
  const authorName = isSignedIn && author?.isAuthor ? author.penName : ''
  const canSubmit =
    work !== null && isSignedIn && !pending && tagError === null && !blockedByDeclarations

  const publicCount = useMemo(
    () =>
      episodes.filter((e) => episodeVisibilityOf(episodeVisibility, e.id, visibility) === 'public')
        .length,
    [episodes, episodeVisibility, visibility],
  )

  /** 行ごとのサウンドノベルの切り替えを出すか（作品の切り替えが ON かつ公開のときだけ意味を持つ） */
  const showGameSwitches =
    Boolean(stagingRepo && gameAssetRepo) && novelGame && visibility === 'public'

  /** いま何話がサウンドノベルになるか（公開する話のうち、作者が ON にした話） */
  const gameCount = useMemo(
    () =>
      episodes.filter(
        (e) =>
          episodeVisibilityOf(episodeVisibility, e.id, visibility) === 'public' &&
          novelGameEpisodeOf(novelGameEpisodes, e.id),
      ).length,
    [episodes, episodeVisibility, visibility, novelGameEpisodes],
  )

  /** 選んだ話のうち、まだ演出を付けていない話の数（＝文字だけで進む話） */
  const unstagedGameCount = useMemo(
    () =>
      episodes.filter(
        (e) =>
          episodeVisibilityOf(episodeVisibility, e.id, visibility) === 'public' &&
          novelGameEpisodeOf(novelGameEpisodes, e.id) &&
          !stagedEpisodeIds.has(e.id),
      ).length,
    [episodes, episodeVisibility, visibility, novelGameEpisodes, stagedEpisodeIds],
  )

  /** 送信・保存する投稿設定。画面の入力から毎回作り直す（前回値のマージは古い値を残す）。 */
  const buildPlatform = (): WorkPlatform => {
    const { lastPublishedAt, workUrl, manageUrl } = work?.platform ?? {}
    return {
      ...(genre !== '' ? { genre } : {}),
      tags,
      declaredAllAges: allAges,
      declaredOriginal: original,
      visibility,
      isCompleted,
      kind,
      // 作品が下書きなら話ごとの記録は送らないが、こちらには残す
      //（下書きへ戻して公開し直したときに、伏せた話が黙って表へ出ないように）
      ...(Object.keys(episodeVisibility).length > 0 ? { episodeVisibility } : {}),
      ...(novelGame ? { novelGame: true } : {}),
      ...(Object.keys(novelGameEpisodes).length > 0 ? { novelGameEpisodes } : {}),
      ...(lastPublishedAt !== undefined ? { lastPublishedAt } : {}),
      ...(workUrl ? { workUrl } : {}),
      ...(manageUrl ? { manageUrl } : {}),
    }
  }

  const submit = async () => {
    if (!work || !canSubmit) return
    setPending(true)
    setResult(null)

    const platform = buildPlatform()
    const desc = description.trim()
    // サウンドノベル（契約 v4）：ON かつ公開のときだけ、演出譜と素材を集めてプレイヤーを同梱する。
    // 前回 ON で今回 OFF のときは v4 で「同梱なし」を宣言し、先方に前回のプレイヤーを消してもらう
    //（何も送らないと v3 になり、先方は据え置き＝OFF が効かないため）。この宣言は
    // **下書きへ戻す送信でも出す**——ここで落とすと、OFF のまま再公開したとき
    // 古いプレイヤーが先方で復活する。
    let gameInput: NovelGameBundleInput | undefined
    if (stagingRepo && gameAssetRepo) {
      if (novelGame && visibility === 'public') {
        // 別の端末で登録した素材（クラウド保管ぶん）を先に取り込む。
        // ここを飛ばすと、その端末に無い背景・立ち絵が抜けたプレイヤーを公開してしまう
        //（作者から見れば「公開したら絵が消えた」になる）。取れなくても公開は止めない
        await pullHostedAssets(gameAssetRepo, createAssetHostingApi(getToken)).catch(() => null)
        gameInput = {
          stagings: await stagingRepo.listByWork(work.id),
          gameAssets: await gameAssetRepo.list(),
        }
      } else if (!novelGame && work.platform?.novelGame === true) {
        gameInput = { stagings: [], gameAssets: [], enabled: false }
      }
    }
    const res = await publishWorkToPlatform(
      getToken,
      { ...work, description: desc, platform },
      gameInput,
    )

    if (res.ok) {
      onPersist(work.id, {
        description: desc,
        platform: {
          ...platform,
          // 誓約欠け・運営の非表示で公開されないことがある。記録は「実際にどうなったか」に合わせる
          visibility: res.published ? 'public' : 'draft',
          lastPublishedAt: Date.now(),
          manageUrl: res.manageUrl,
          ...(res.workUrl ? { workUrl: res.workUrl } : {}),
        },
      })
      if (!res.published) setVisibility('draft')
    }
    if (!res.ok && res.needsAuthor) {
      // 登録が要ると分かったので、そのまま登録カードを出す
      setAuthor({ isAuthor: false, suspended: false, penName: '' })
    }
    setResult(res)
    setPending(false)
  }

  if (!work) {
    return (
      <PageLayout title="公開の管理" backHref="#/" backLabel="ライブラリへ戻る">
        <p className="text-[14px] text-on-surface-variant">
          公開する作品が開かれていません。ライブラリから作品を選んでください。
        </p>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="公開の管理"
      description={`${work.title} を コトノハ-grove-（読者向けサイト）へ出すための設定です。`}
      backHref={backHref}
      backLabel={backLabel}
      wide
    >
      <div className="space-y-6">
        {!isSignedIn ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
            <h2 className="font-semibold font-serif text-[17px] text-on-surface">
              公開にはサインインが必要です
            </h2>
            <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
              執筆アカウントがそのまま公開アカウントになります。書き出し（EPUB・カクヨム・なろう）は
              サインインしなくても使えます。
            </p>
            {onSignIn ? (
              <Button type="button" onClick={onSignIn} className="mt-4">
                サインイン
              </Button>
            ) : null}
          </section>
        ) : null}

        {needsAuthor ? (
          <AuthorRegisterCard
            status={author}
            getToken={getToken}
            onRegistered={(penName) => {
              setAuthor({ isAuthor: true, suspended: false, penName })
              setResult(null)
            }}
          />
        ) : null}

        {/* 0. どの名前で公開されるか。押してから知る作りにしない */}
        {!needsAuthor && authorName !== '' ? <AuthorNameCard penName={authorName} /> : null}

        {/* 1. 作品の公開状態。ここが「単話ではなく作品の話」だと分かる場所になる */}
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
          <h2 className="font-semibold font-serif text-[17px] text-on-surface">作品の公開状態</h2>
          <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
            作品ごとの設定です。下書きのあいだは、話をいくつ公開にしても読者には見えません。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(['draft', 'public'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visibility === v}
                onClick={() => setVisibility(v)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-4 py-2 font-sans text-[13px] transition-colors',
                  visibility === v
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {v === 'public' ? (
                  <Eye className="size-4" aria-hidden />
                ) : (
                  <EyeOff className="size-4" aria-hidden />
                )}
                {v === 'public' ? '公開' : '下書き（非公開）'}
              </button>
            ))}
          </div>
          {work.platform?.lastPublishedAt !== undefined ? (
            <p className="mt-3 text-[12px] text-on-surface-variant/70">
              いま コトノハ-grove- に反映されているのは「
              {work.platform.visibility === 'public' ? '公開' : '下書き'}」です。
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-on-surface-variant/70">
              この作品はまだ コトノハ-grove-
              へ送られていません。下の「公開状態を更新」で送られます。
            </p>
          )}
        </section>

        {/* 2. 話ごとの公開。作品が公開のときだけ意味を持つ */}
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold font-serif text-[17px] text-on-surface">話ごとの公開</h2>
            <span className="text-[12px] text-on-surface-variant tabular-nums">
              {visibility === 'public' ? `${publicCount} / ${episodes.length} 話を公開` : '—'}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
            {visibility !== 'public'
              ? '作品が下書きのあいだは変更できません。上で「公開」を選ぶと操作できます。'
              : showGameSwitches
                ? '公開しない話は伏せておけます。伏せた話も本文はこちらに残ります。右の「サウンドノベル」を入れた話だけが、遊べる形でも出ます。'
                : '公開しない話は伏せておけます。伏せた話も本文はこちらに残ります。'}
          </p>

          {episodes.length === 0 ? (
            <p className="mt-4 text-[13px] text-on-surface-variant/70">
              まだ話がありません。執筆画面で話を追加してください。
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-outline-variant/30 border-outline-variant/30 border-y">
              {episodes.map((ep, index) => {
                const epVisible =
                  episodeVisibilityOf(episodeVisibility, ep.id, visibility) === 'public'
                const epGame = novelGameEpisodeOf(novelGameEpisodes, ep.id)
                return (
                  <li
                    key={ep.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[12px] text-on-surface-variant/60 tabular-nums">
                          {index + 1}
                        </span>
                        <span className="truncate font-sans text-[14px] text-on-surface">
                          {ep.title || '無題'}
                        </span>
                      </div>
                      <span className="ml-6 text-[11px] text-on-surface-variant/60 tabular-nums">
                        {countEpisodeChars(ep).toLocaleString('ja-JP')}字
                      </span>
                    </div>

                    {/* 書き出しは話ごと。コトノハ-grove- に出さない話でも、外部サイトへは出せる */}
                    <div className="flex shrink-0 items-center gap-1">
                      <ExportButton
                        label="カクヨム"
                        onClick={() => triggerDownload(episodeKakuyomuExport(work.title, ep))}
                      />
                      <ExportButton
                        label="なろう"
                        onClick={() => triggerDownload(episodeNarouExport(work.title, ep))}
                      />
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* サウンドノベルにする話を選ぶ。作品の切り替えが ON のときだけ意味を持つ */}
                      {showGameSwitches && (
                        <div className="mr-2 flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className={cn(
                              'font-sans text-[12px]',
                              epGame && epVisible
                                ? 'text-on-surface-variant'
                                : 'text-on-surface-variant/50',
                            )}
                          >
                            サウンドノベル
                          </span>
                          <Switch
                            aria-label={`「${ep.title || '無題'}」をサウンドノベルにする`}
                            checked={epGame && epVisible}
                            disabled={!epVisible}
                            onCheckedChange={(next) =>
                              setNovelGameEpisodes((prev) => ({ ...prev, [ep.id]: next }))
                            }
                          />
                        </div>
                      )}
                      {/* 行が並ぶので、状態表示は目で追う用。読み上げには話名入りの aria-label を使う */}
                      <span
                        aria-hidden
                        className="w-10 text-right font-sans text-[12px] text-on-surface-variant"
                      >
                        {epVisible ? '公開' : '非公開'}
                      </span>
                      <Switch
                        aria-label={`「${ep.title || '無題'}」を公開する`}
                        checked={epVisible}
                        disabled={visibility !== 'public'}
                        onCheckedChange={(next) =>
                          setEpisodeVisibility((prev) => ({
                            ...prev,
                            [ep.id]: next ? 'public' : 'draft',
                          }))
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 2.5 サウンドノベル（契約 v4）。公開する話にプレイヤー付きの読み方が並ぶ */}
        {stagingRepo && gameAssetRepo ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold font-serif text-[17px] text-on-surface">
                  サウンドノベル
                </h2>
                <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
                  コトノハ-grove-
                  に「サウンドノベルで読む」形の読み方を足します。出すのは話ごとです。
                  下の「話ごとの公開」で、この形にする話をひとつずつ選んでください。
                  <strong className="font-semibold">選んでいない話は出ません</strong>
                  ——演出を付けてある話でも、調整の途中なら手元に置いたままにできます。
                  文章での読み方はそのまま残ります。スマートフォンでも遊べます。
                </p>
              </div>
              <Switch
                aria-label="サウンドノベルでも公開する"
                checked={novelGame}
                disabled={visibility !== 'public'}
                onCheckedChange={setNovelGame}
              />
            </div>
            {visibility !== 'public' ? (
              <p className="mt-3 text-[12px] text-on-surface-variant/70">
                作品が下書きのあいだは変更できません。上で「公開」を選ぶと操作できます。
              </p>
            ) : novelGame ? (
              <>
                <p className="mt-3 text-[12px] text-on-surface-variant/70 tabular-nums">
                  {gameCount === 0
                    ? 'いまはどの話も選ばれていません。下の一覧で、サウンドノベルにする話を選んでください。'
                    : `公開する ${publicCount} 話のうち ${gameCount} 話をサウンドノベルにします。`}
                </p>
                {unstagedGameCount > 0 ? (
                  <p className="mt-1.5 text-[12px] text-on-surface-variant/70 tabular-nums">
                    そのうち {unstagedGameCount}{' '}
                    話には演出（話者・背景・立ち絵・効果音）がまだありません。黒い画面に本文が出る形で進みます。
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {/* 3. コトノハ-grove- へ渡す情報 */}
        <section className="space-y-5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
          <h2 className="font-semibold font-serif text-[17px] text-on-surface">
            コトノハ-grove- へ渡す情報
          </h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${uid}-description`}>あらすじ</Label>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  description.length >= MAX_DESCRIPTION_LENGTH
                    ? 'text-destructive'
                    : 'text-on-surface-variant/50',
                )}
              >
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
            </div>
            <Textarea
              id={`${uid}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="読者が最初に読む紹介文（任意）"
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              className="max-h-40"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-genre`}>ジャンル</Label>
              <select
                id={`${uid}-genre`}
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-surface-container-lowest px-3 font-sans text-base text-on-surface outline-none transition-colors focus:border-primary md:text-sm"
              >
                <option value="">未選択</option>
                {PLATFORM_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <span className="font-medium text-sm">形式</span>
              <div className="flex gap-2">
                {(['serial', 'oneshot'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm transition-colors',
                      kind === k
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    {k === 'serial' ? '連載' : '読み切り'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${uid}-tags`}>
              タグ（読点区切り・{PLATFORM_MAX_TAGS}件まで・任意）
            </Label>
            <Textarea
              id={`${uid}-tags`}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="異世界、幼馴染、ハッピーエンド"
              rows={2}
              className="max-h-20"
            />
            {tagError ? (
              <p role="alert" className="text-destructive text-xs">
                {tagError}
              </p>
            ) : (
              <p className="text-on-surface-variant/70 text-xs">
                ジャンルに収まらない言葉はタグへ。1件{PLATFORM_MAX_TAG_LENGTH}字まで。
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant/30 p-3">
            <Label htmlFor={`${uid}-completed`} className="font-normal text-on-surface text-sm">
              この作品は完結している
              <span className="mt-0.5 block text-on-surface-variant text-xs">
                完結済みとして読者に伝わります。あとから変えられます。
              </span>
            </Label>
            <Switch
              id={`${uid}-completed`}
              checked={isCompleted}
              onCheckedChange={setIsCompleted}
            />
          </div>

          {/* 誓約（規約同意）。既定オフ・自動チェックはしない。公開の可否だけがこれに依る */}
          <fieldset className="space-y-2 rounded-lg border border-outline-variant/30 p-3">
            <legend className="px-1 font-sans text-on-surface-variant text-xs">
              公開するための誓約
            </legend>
            <label className="flex cursor-pointer items-start gap-2 font-sans text-on-surface text-sm">
              <input
                type="checkbox"
                checked={allAges}
                onChange={(e) => setAllAges(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              {/* 文は1つの要素にまとめる。flex 直下にテキストを置くと語ごとに項目化して折り返しが崩れる */}
              <span>
                この作品は<strong>全年齢向け</strong>です。
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 font-sans text-on-surface text-sm">
              <input
                type="checkbox"
                checked={original}
                onChange={(e) => setOriginal(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                この作品は<strong>自分が書いた一次創作</strong>で、無断転載ではありません。
              </span>
            </label>
          </fieldset>
        </section>

        {/* 4. 手元に取り出す（作品まるごと） */}
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
          <h2 className="font-semibold font-serif text-[17px] text-on-surface">作品を書き出す</h2>
          <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
            カクヨム・小説家になろうへは話ごとに出せます（各話の行のボタン）。 EPUB
            は1作品＝1冊として、縦書きで書き出します。
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => triggerDownload(workEpubExport(work))}
            className="mt-4 gap-2 text-primary"
          >
            <BookText className="size-4" aria-hidden />
            EPUB を書き出す
          </Button>
        </section>

        {result ? <PublishResultPanel result={result} /> : null}

        {/* 反映はここだけ。設定をいじった時点では何も起きない */}
        <div className="sticky bottom-0 -mx-6 border-outline-variant/30 border-t bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockedByDeclarations ? (
              <p className="text-[12px] text-on-surface-variant">
                公開するには、上の誓約2つにチェックが必要です。
              </p>
            ) : null}
            {needsAuthor ? (
              <p className="text-[12px] text-on-surface-variant">
                先に作者登録を済ませてください。
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canSubmit}
              className="gap-2"
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <CloudUpload className="size-4" aria-hidden />
              )}
              公開状態を更新
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={visibility === 'public' ? 'この内容で公開しますか？' : '下書きに戻しますか？'}
        description={
          visibility === 'public'
            ? `「${work.title}」を${
                authorName === '' ? '' : `、作者名「${authorName}」で`
              }公開します。${publicCount}話が読者に見えるようになります${
                episodes.length - publicCount > 0
                  ? `（${episodes.length - publicCount}話は非公開のまま）`
                  : ''
              }。本文もいまの内容で置き換わります。`
            : `「${work.title}」を下書きに戻します。読者からは見えなくなります（いいね・コメントは残ります）。`
        }
        confirmLabel={visibility === 'public' ? '公開する' : '下書きに戻す'}
        destructive={false}
        onConfirm={() => void submit()}
      />
    </PageLayout>
  )
}

/** 話ごとの書き出しボタン（行の中に収まる小さいもの）。 */
function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}形式のテキストを書き出す`}
      className="flex items-center gap-1 rounded-md border border-outline-variant/40 px-2 py-1 font-sans text-[11px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
    >
      <Download className="size-3" aria-hidden />
      {label}
    </button>
  )
}

/** 反映の結果（公開されたか・失敗理由）と、次に開く先の導線。 */
function PublishResultPanel({ result }: { result: PublishResult }) {
  if (!result.ok) {
    return (
      <div role="alert" className="space-y-2 rounded-xl border border-destructive/40 p-4">
        <p className="font-sans text-destructive text-sm leading-relaxed">{result.message}</p>
        {result.registerUrl && !result.needsAuthor ? (
          <PlatformLink href={result.registerUrl}>コトノハ-grove- を開く</PlatformLink>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-sans text-on-surface text-sm leading-relaxed">
        {result.published
          ? '公開しました。読者が読める状態です。'
          : result.publishBlocked
            ? describePublishBlocked(result.publishBlocked)
            : '下書きとして反映しました。まだ読者には見えません。'}
      </p>
      <div className="flex flex-wrap gap-3">
        {result.published && result.workUrl ? (
          <PlatformLink href={result.workUrl}>公開ページを開く</PlatformLink>
        ) : null}
        <PlatformLink href={result.manageUrl}>コトノハ-grove- の管理画面を開く</PlatformLink>
      </div>
    </div>
  )
}

/**
 * この作品がどの名前で公開されるか。**押す前に見えるところへ出す**。
 *
 * コトノハ-grove- の作者名とコトノハ-leaf- のペンネームは別々に持っている。投稿バンドルにも著者名は
 * 入っているが、コトノハ-grove- はそれを無視して登録済みのペンネームを常に優先する
 *（platform の `import-work.ts`）。画面のどこにも出していなかったので、
 * 「どちらの名前で出るのか」「片方を変えたらもう片方も変わるのか」を確かめようがなかった。
 *
 * 名前そのものを大きく出し、説明は 2 つに分ける——いまどうなっているか（1 つめ）と、
 * 変えたいときどうなるか（2 つめ）。変更の口は コトノハ-grove- 側にしかないので、リンクで渡す。
 */
function AuthorNameCard({ penName }: { penName: string }) {
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
      <h2 className="font-semibold font-serif text-[17px] text-on-surface">作者名</h2>
      <p className="mt-2 font-medium text-[15px] text-on-surface [overflow-wrap:anywhere]">
        {penName}
      </p>
      <p className="mt-2 text-[13px] text-on-surface-variant leading-relaxed">
        コトノハ-grove- では、この名前で作者として表示されます。コトノハ-leaf-
        のペンネームとは別の設定なので、ペンネームを変えてもここは変わりません。
      </p>
      <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
        名前は コトノハ-grove-
        の設定で変えられます。変えると、これまでに公開した作品の作者名も一緒に変わります。
      </p>
      {PLATFORM_ORIGIN ? (
        <div className="mt-4">
          <PlatformLink href={`${PLATFORM_ORIGIN}/settings`}>
            コトノハ-grove- の設定を開く
          </PlatformLink>
        </div>
      ) : null}
    </section>
  )
}

/** コトノハ-grove- への外部リンク（別タブ）。 */
function PlatformLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 font-sans text-primary text-sm hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}
