import {
  Archive,
  BookMarked,
  BookOpen,
  CircleHelp,
  FlaskConical,
  FolderOpen,
  Library,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { type ComponentType, useId } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'

export type NavKey = 'collection' | 'episodes' | 'glossary' | 'research' | 'archive'

interface EpisodeItem {
  id: string
  title: string
}

interface SideNavProps {
  /** アプリの恒常アイデンティティ見出し（作品名ではない）。 */
  projectTitle: string
  projectSubtitle?: string
  active: NavKey
  /** コレクション（ライブラリ）へ */
  onNavigateCollection: () => void
  /** 主要 CTA（新しいプロジェクト / 新しいエピソード） */
  cta: { label: string; onClick: () => void; disabled?: boolean }
  /**
   * 開いている作品のタイトル。指定時は「現在の作品」スコープカードを中身入りで描く。
   * 省略時（ライブラリ）はカードを空状態（作品を開く前の案内）で描く。
   */
  workTitle?: string
  /** エピソード画面へ切替（作品オープン時のみ） */
  onNavigateEpisodes?: () => void
  /** 辞書画面へ切替（作品オープン時のみ） */
  onNavigateGlossary?: () => void
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
  /** 「準備中」等の未実装ラベル。付与時は自動的に無効化し、押せない見た目にする。 */
  badge?: string
}

function NavRow({ icon: Icon, label, active, onClick, disabled, badge }: NavRowProps) {
  const isDisabled = disabled || badge !== undefined
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left font-medium font-sans text-sm transition-colors',
        active
          ? 'border-primary border-l-4 bg-surface-container text-primary'
          : 'text-on-surface-variant hover:bg-surface-container-high',
        isDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 rounded-full border border-outline-variant/40 bg-surface-container px-2 py-0.5 font-medium text-[10px] text-on-surface-variant/70 tracking-wide">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/** 作品/話のナビゲーション（ライブラリ・エディタ共通の 260px サイドバー）。 */
export function SideNav({
  projectTitle,
  projectSubtitle,
  active,
  onNavigateCollection,
  onNavigateEpisodes,
  onNavigateGlossary,
  cta,
  workTitle,
  episodes,
  currentEpisodeId,
  onSelectEpisode,
  onRenameEpisode,
  onDeleteEpisode,
}: SideNavProps) {
  const initial = (projectTitle.trim().charAt(0) || 'N').toUpperCase()
  const scopeCaptionId = useId()
  // 作品が開いていれば中身入りカード、未オープンなら空状態カード。
  const workOpen = workTitle !== undefined
  return (
    <nav className="flex w-sidebar shrink-0 flex-col border-outline-variant/20 border-r bg-surface-container-low py-6 font-sans">
      {/* アプリのアイデンティティ見出し（両状態で固定） */}
      <div className="mb-6 flex items-center gap-3 px-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary-container font-bold font-serif text-lg text-on-secondary-container">
          {initial}
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-bold text-on-surface text-sm">{projectTitle}</h2>
          {projectSubtitle ? (
            <p className="truncate text-on-surface-variant text-xs">{projectSubtitle}</p>
          ) : null}
        </div>
      </div>

      {/* CTA */}
      <div className="mb-6 px-6">
        <Button
          variant="outline"
          onClick={cta.onClick}
          disabled={cta.disabled}
          className="w-full gap-2 border-primary text-primary hover:bg-primary/5 hover:text-primary"
        >
          <Plus className="size-4" />
          {cta.label}
        </Button>
      </div>

      {/* 中段: ホーム → 作品スコープカード → 作品非依存 */}
      <div className="flex min-h-0 flex-1 flex-col px-4">
        <NavRow
          icon={Library}
          label="コレクション"
          active={active === 'collection'}
          onClick={onNavigateCollection}
        />

        {/* 作品スコープカード: この箱の中身は「いま開いている作品」のもの、と境界で示す。 */}
        {/* biome-ignore lint/a11y/useSemanticElements: ナビ内の軽量グルーピング。fieldset はフォーム用途で不適、section はランドマーク増を招くため role=group を採用。 */}
        <div
          role="group"
          aria-labelledby={scopeCaptionId}
          className={cn(
            'mt-3 flex flex-col rounded-lg border bg-surface-container-lowest p-2',
            workOpen
              ? 'min-h-0 flex-1 border-outline-variant/30'
              : 'shrink-0 border-outline-variant/40 border-dashed',
          )}
        >
          <div className="px-2 pt-1 pb-2">
            <div
              id={scopeCaptionId}
              className="font-sans text-[10px] text-on-surface-variant/60 uppercase tracking-widest"
            >
              現在の作品
            </div>
            {workOpen ? (
              <div className="mt-0.5 flex items-center gap-1.5 font-medium font-serif text-on-surface text-sm">
                <FolderOpen className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">{workTitle}</span>
              </div>
            ) : null}
          </div>

          {workOpen ? (
            <>
              <div className="space-y-1">
                <NavRow
                  icon={BookOpen}
                  label="エピソード"
                  active={active === 'episodes'}
                  onClick={onNavigateEpisodes}
                />
                <NavRow
                  icon={BookMarked}
                  label="辞書"
                  active={active === 'glossary'}
                  onClick={onNavigateGlossary}
                />
              </div>

              {/* 話サブリスト（カード内・最下段でスクロール）。
                  flex-col で「現在の草稿」ラベルを固定し、ScrollArea は h-full（百分率）
                  ではなく flex-1 min-h-0 で残り高さを受ける。深いネストでも高さが確実に
                  解決し、スクロールがカード内に収まる。 */}
              {episodes && episodes.length > 0 ? (
                <div className="mt-3 flex min-h-0 flex-1 flex-col">
                  <div className="mb-2 shrink-0 px-2 font-sans text-[11px] text-on-surface-variant/70 uppercase tracking-widest">
                    現在の草稿
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <ul className="ml-2 space-y-1 border-outline-variant/30 border-l pl-3">
                      {episodes.map((e) => {
                        const isCurrent = e.id === currentEpisodeId
                        return (
                          <li key={e.id} className="group relative flex items-center gap-1">
                            {isCurrent ? (
                              <span className="-left-[13px] -translate-y-1/2 absolute top-1/2 size-1.5 rounded-full bg-primary" />
                            ) : null}
                            <button
                              type="button"
                              onClick={() => onSelectEpisode?.(e.id)}
                              aria-current={isCurrent ? 'true' : undefined}
                              className={cn(
                                'block min-w-0 flex-1 truncate py-1 text-left text-sm transition-colors',
                                isCurrent
                                  ? 'font-medium text-primary'
                                  : 'text-on-surface-variant hover:text-primary',
                              )}
                            >
                              {e.title}
                            </button>
                            {onRenameEpisode ? (
                              <button
                                type="button"
                                onClick={() => onRenameEpisode(e.id)}
                                aria-label={`「${e.title}」のタイトルを変更`}
                                className="shrink-0 rounded p-1 text-on-surface-variant/60 opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            ) : null}
                            {onDeleteEpisode ? (
                              <button
                                type="button"
                                onClick={() => onDeleteEpisode(e.id)}
                                aria-label={`「${e.title}」を削除`}
                                className="shrink-0 rounded p-1 text-on-surface-variant/60 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </ScrollArea>
                </div>
              ) : null}
            </>
          ) : (
            /* 空状態: 作品を開く前。グレーアウト兄弟を置き換える案内＋装飾プレビュー。 */
            <div className="px-2 pb-2">
              <p className="mb-3 text-on-surface-variant/70 text-xs leading-relaxed">
                作品を開くとエピソードと辞書がここに表示されます。
              </p>
              <div aria-hidden="true" className="space-y-1 opacity-40">
                <div className="flex items-center gap-3 rounded-md px-4 py-2 font-medium font-sans text-on-surface-variant text-sm">
                  <BookOpen className="size-5 shrink-0" />
                  <span>エピソード</span>
                </div>
                <div className="flex items-center gap-3 rounded-md px-4 py-2 font-medium font-sans text-on-surface-variant text-sm">
                  <BookMarked className="size-5 shrink-0" />
                  <span>辞書</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 作品非依存の機能（カード外） */}
        <div className="mt-3 shrink-0 space-y-1">
          <NavRow icon={FlaskConical} label="リサーチ" badge="準備中" />
          <NavRow icon={Archive} label="アーカイブ" badge="準備中" />
        </div>
      </div>

      {/* フッター */}
      <div className="mt-8 space-y-1 px-4">
        <NavRow icon={Settings} label="設定" disabled />
        <NavRow icon={CircleHelp} label="ヘルプ" disabled />
      </div>
    </nav>
  )
}
