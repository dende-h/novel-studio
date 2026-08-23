import {
  ArrowLeft,
  BookMarked,
  CircleHelp,
  ExternalLink,
  FileText,
  Library,
  ListTree,
  Milestone,
  Network,
  Pencil,
  PenLine,
  Plus,
  Settings,
  Sprout,
  StickyNote,
  Trash2,
  Trees,
  UserRound,
  Waypoints,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { PLATFORM_ORIGIN } from '@/ui/_api/publish'
import { coverTone } from '@/ui/_utils/cover-tone'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

export type NavKey =
  | 'collection'
  | 'activity'
  | 'ideas'
  | 'episodes'
  | 'glossary'
  | 'plot'
  | 'outline'
  | 'mindmap'
  | 'chart'

interface EpisodeItem {
  id: string
  title: string
}

interface SideNavProps {
  active: NavKey
  /** マイライブラリへ（ライブラリ時はホーム行・作品時は戻るリンク） */
  onNavigateCollection: () => void
  /** 執筆の記録（草・ストリーク）へ。指定時のみ表示。 */
  onNavigateActivity?: () => void
  /** ネタ帳（アイデアの受け皿）へ。指定時のみ表示。 */
  onNavigateIdeas?: () => void
  /** ゴミ箱を開く。指定時のみ表示（ライブラリがダイアログをホストする）。 */
  onNavigateTrash?: () => void
  /** 設定ページへ。指定時のみフッターの「設定」を有効化。 */
  onNavigateSettings?: () => void
  /** ヘルプページへ。指定時のみフッターの「ヘルプ」を有効化。 */
  onNavigateHelp?: () => void
  /**
   * 公開サイト（コトノハ-grove-）のURL。省略時はビルド設定（VITE_PLATFORM_ORIGIN）。
   * 空のビルド（投稿先未設定）ではリンク自体を出さない。
   */
  platformHref?: string
  /** 主要 CTA（新しい作品 / 新しいエピソード）。作成導線が無い画面（執筆の記録）では省略。 */
  cta?: { label: string; onClick: () => void; disabled?: boolean }
  /** 作者プロフィール（ペンネーム・アバター）。onEditProfile と併せて指定時のみ表示。 */
  profile?: { penName?: string; avatar?: string }
  /** プロフィール編集を開く。指定時のみプロフィール欄を表示。 */
  onEditProfile?: () => void
  /**
   * 開いている作品のタイトル。指定時は「作品モード」（戻るリンク＋作品カード＋本文/用語集ナビ＋草稿）。
   * 省略時（ライブラリ・執筆の記録）は「ライブラリモード」（プロフィール＋CTA＋メインナビ）。
   */
  workTitle?: string
  /** 作品情報（タイトル・あらすじ・表紙）の編集を開く。指定時のみ作品カードを押せるようにする。 */
  onEditWorkMeta?: () => void
  /** 作品カードに出すメタ情報（例: 「3話 ・ 12,480字」）。 */
  workMeta?: string
  /** エディタ画面へ切替（作品オープン時のみ） */
  onNavigateEpisodes?: () => void
  /** 用語集画面へ切替（作品オープン時のみ） */
  onNavigateGlossary?: () => void
  /** プロット（幕×ビートの物語設計）へ切替（作品オープン＋cloud会員時のみ） */
  onNavigatePlot?: () => void
  /** アウトラインへ切替（作品オープン＋cloud会員時のみ） */
  onNavigateOutline?: () => void
  /** マインドマップへ切替（作品オープン＋cloud会員時のみ） */
  onNavigateMindmap?: () => void
  /** 相関図へ切替（作品オープン＋cloud会員時のみ） */
  onNavigateChart?: () => void
  /** エディタ時の話サブリスト */
  episodes?: EpisodeItem[]
  currentEpisodeId?: string | null
  onSelectEpisode?: (id: string) => void
  /** 話のタイトル変更（指定時のみ各話に変更ボタンを表示） */
  onRenameEpisode?: (id: string) => void
  /** 話の削除（指定時のみ各話に削除ボタンを表示） */
  onDeleteEpisode?: (id: string) => void
}

interface NavRowProps {
  icon: ComponentType<{ className?: string }>
  label: string
  active?: boolean
  onClick?: () => void
  disabled?: boolean
}

function NavRow({ icon: Icon, label, active, onClick, disabled }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left font-medium font-sans text-[13px] transition-colors',
        active
          ? 'bg-surface-container-lowest text-primary shadow-xs'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
        disabled &&
          'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-on-surface-variant',
      )}
    >
      <Icon className="size-[15px] shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

/** 作品/話のナビゲーション（ライブラリ・エディタ共通の 248px サイドバー）。 */
export function SideNav({
  active,
  onNavigateCollection,
  onNavigateActivity,
  onNavigateIdeas,
  onNavigateTrash,
  onNavigateSettings,
  onNavigateHelp,
  onNavigateEpisodes,
  onNavigateGlossary,
  onNavigatePlot,
  onNavigateOutline,
  onNavigateMindmap,
  onNavigateChart,
  cta,
  profile,
  onEditProfile,
  onEditWorkMeta,
  workTitle,
  workMeta,
  episodes,
  currentEpisodeId,
  onSelectEpisode,
  onRenameEpisode,
  onDeleteEpisode,
  platformHref,
}: SideNavProps) {
  const groveHref = platformHref ?? PLATFORM_ORIGIN
  // 作品が開いていれば作品モード（戻る＋作品カード＋本文/用語集）、未オープンはライブラリモード。
  const workOpen = workTitle !== undefined
  const workInitial = (workTitle ?? '').trim().charAt(0) || '無'
  return (
    // 1 ページに nav が複数あるとき（執筆の記録の年タブ等）、支援技術が区別できるよう名前を付ける。
    <nav
      aria-label="メインメニュー"
      className="flex w-sidebar shrink-0 flex-col gap-2.5 overflow-y-auto border-outline-variant/30 border-r bg-surface-container-low px-3 pt-4 pb-3.5 font-sans"
    >
      {workOpen ? (
        <>
          {/* ライブラリへ戻る */}
          <button
            type="button"
            onClick={onNavigateCollection}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <ArrowLeft className="size-4 shrink-0" />
            マイライブラリ
          </button>

          {/* 現在の作品カード。onEditWorkMeta があれば作品情報の編集口も兼ねる
              （プロフィールカードと同じ流儀＝カード全体がボタン＋鉛筆）。 */}
          {(() => {
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className="flex h-11 w-8 shrink-0 items-center justify-center rounded border border-outline-variant/30 font-serif text-[14px] text-on-surface"
                  style={{ background: coverTone(workTitle ?? '') }}
                >
                  {workInitial}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="line-clamp-2 block font-semibold font-serif text-[13px] text-on-surface leading-normal">
                    {workTitle}
                  </span>
                  {workMeta ? (
                    <span className="mt-0.5 block truncate text-[11px] text-on-surface-variant">
                      {workMeta}
                    </span>
                  ) : null}
                </span>
              </>
            )
            const cardClass =
              'flex w-full gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3'
            return onEditWorkMeta ? (
              <button
                type="button"
                onClick={onEditWorkMeta}
                aria-label="作品情報を編集"
                className={cn(cardClass, 'group items-start text-left hover:border-primary/40')}
              >
                {body}
                <Pencil className="size-3.5 shrink-0 text-on-surface-variant/50 transition-colors group-hover:text-primary" />
              </button>
            ) : (
              <div className={cardClass}>{body}</div>
            )
          })()}

          {/* 作品スコープのナビ */}
          <div className="space-y-0.5">
            <NavRow
              icon={PenLine}
              label="本文を書く"
              active={active === 'episodes'}
              onClick={onNavigateEpisodes}
            />
            <NavRow
              icon={BookMarked}
              label="用語集"
              active={active === 'glossary'}
              onClick={onNavigateGlossary}
            />
            {onNavigatePlot ? (
              <NavRow
                icon={Milestone}
                label="プロット"
                active={active === 'plot'}
                onClick={onNavigatePlot}
              />
            ) : null}
            {onNavigateOutline ? (
              <NavRow
                icon={ListTree}
                label="アウトライン"
                active={active === 'outline'}
                onClick={onNavigateOutline}
              />
            ) : null}
            {onNavigateChart ? (
              <NavRow
                icon={Network}
                label="相関図"
                active={active === 'chart'}
                onClick={onNavigateChart}
              />
            ) : null}
            {onNavigateMindmap ? (
              <NavRow
                icon={Waypoints}
                label="マインドマップ"
                active={active === 'mindmap'}
                onClick={onNavigateMindmap}
              />
            ) : null}
          </div>

          {/* 草稿（話リスト） */}
          {episodes && episodes.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 px-3 pt-2 pb-1.5 font-medium text-[11px] text-on-surface-variant/60 tracking-widest">
                草稿
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <ul className="space-y-0.5">
                  {episodes.map((e) => {
                    const isCurrent = e.id === currentEpisodeId
                    return (
                      <li key={e.id} className="group relative flex items-center">
                        <button
                          type="button"
                          onClick={() => onSelectEpisode?.(e.id)}
                          aria-current={isCurrent ? 'true' : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
                            isCurrent
                              ? 'bg-surface-container-lowest font-medium text-primary shadow-xs'
                              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                          )}
                        >
                          <FileText className="size-[15px] shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{e.title}</span>
                        </button>
                        {onRenameEpisode || onDeleteEpisode ? (
                          <span className="absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            {onRenameEpisode ? (
                              <button
                                type="button"
                                onClick={() => onRenameEpisode(e.id)}
                                aria-label={`「${e.title}」のタイトルを変更`}
                                className="rounded bg-surface-container-low/90 p-1 text-on-surface-variant/70 transition-colors hover:text-primary"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            ) : null}
                            {onDeleteEpisode ? (
                              <button
                                type="button"
                                onClick={() => onDeleteEpisode(e.id)}
                                aria-label={`「${e.title}」を削除`}
                                className="rounded bg-surface-container-low/90 p-1 text-on-surface-variant/70 transition-colors hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            </div>
          ) : null}

          {/* 新しいエピソード */}
          {cta ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={cta.onClick}
              disabled={cta.disabled}
              className="w-full justify-center gap-1.5 text-on-surface-variant hover:text-primary"
            >
              <Plus className="size-4" />
              {cta.label}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {/* 作者プロフィール */}
          {onEditProfile ? (
            <div className="group flex w-full items-center gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 transition-colors hover:border-outline-variant/50">
              {/* アバターはクリックで拡大（編集は右側のテキスト/鉛筆から）。未設定時は編集ボタンの一部。 */}
              {profile?.avatar ? (
                <ZoomableImage
                  src={profile.avatar}
                  alt={profile.penName ? `${profile.penName}のアバター` : 'アバター'}
                  className="size-8 rounded-full object-cover"
                />
              ) : null}
              <button
                type="button"
                onClick={onEditProfile}
                aria-label="プロフィールを編集"
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                {profile?.avatar ? null : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                    <UserRound className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[13px] text-on-surface">
                    {profile?.penName || 'ペンネーム未設定'}
                  </span>
                  <span className="block truncate text-[11px] text-on-surface-variant">
                    {profile?.penName ? 'プロフィールを編集' : 'タップして登録'}
                  </span>
                </span>
                <Pencil className="size-3.5 shrink-0 text-on-surface-variant/50 transition-colors group-hover:text-primary" />
              </button>
            </div>
          ) : null}

          {/* 新しい作品 */}
          {cta ? (
            <Button
              variant="outline"
              onClick={cta.onClick}
              disabled={cta.disabled}
              className="w-full gap-2 border-outline-variant/40 text-on-surface hover:border-primary hover:text-primary"
            >
              <Plus className="size-4" />
              {cta.label}
            </Button>
          ) : null}

          {/* メインナビ */}
          <div className="mt-1 space-y-0.5">
            <NavRow
              icon={Library}
              label="マイライブラリ"
              active={active === 'collection'}
              onClick={onNavigateCollection}
            />
            {onNavigateActivity ? (
              <NavRow
                icon={Sprout}
                label="執筆の記録"
                active={active === 'activity'}
                onClick={onNavigateActivity}
              />
            ) : null}
            {onNavigateIdeas ? (
              <NavRow
                icon={StickyNote}
                label="ネタ帳"
                active={active === 'ideas'}
                onClick={onNavigateIdeas}
              />
            ) : null}
            {onNavigateTrash ? (
              <NavRow icon={Trash2} label="ゴミ箱" onClick={onNavigateTrash} />
            ) : null}
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* フッター */}
      <div className="space-y-0.5">
        {/* 公開サイト（コトノハ-grove-）へ。読みに行く導線なので新しいタブで開き、執筆を離れない。 */}
        {groveHref ? (
          <a
            href={groveHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 font-medium font-sans text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <Trees className="size-[15px] shrink-0" />
            <span className="flex-1 truncate">コトノハ-grove-</span>
            <ExternalLink aria-hidden className="size-3 shrink-0 text-on-surface-variant/50" />
          </a>
        ) : null}
        <NavRow
          icon={Settings}
          label="設定"
          onClick={onNavigateSettings}
          disabled={!onNavigateSettings}
        />
        <NavRow
          icon={CircleHelp}
          label="ヘルプ"
          onClick={onNavigateHelp}
          disabled={!onNavigateHelp}
        />
      </div>
      {/* 法務リンク（public/ 配下の静的HTMLへ実URLの anchor で飛ぶ＝フルナビゲーション） */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pt-1 text-[11px] text-on-surface-variant/60">
        <a href="/terms" className="no-underline hover:text-primary">
          利用規約
        </a>
        <a href="/privacy" className="no-underline hover:text-primary">
          プライバシー
        </a>
      </div>
    </nav>
  )
}
