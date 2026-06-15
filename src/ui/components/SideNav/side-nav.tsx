import {
  Archive,
  BookOpen,
  CircleHelp,
  FlaskConical,
  Library,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'

export type NavKey = 'collection' | 'episodes' | 'research' | 'archive'

interface EpisodeItem {
  id: string
  title: string
}

interface SideNavProps {
  projectTitle: string
  projectSubtitle?: string
  active: NavKey
  /** コレクション（ライブラリ）へ */
  onNavigateCollection: () => void
  /** 主要 CTA（新しいプロジェクト / 新しいエピソード） */
  cta: { label: string; onClick: () => void; disabled?: boolean }
  /** エディタ時の話サブリスト */
  episodes?: EpisodeItem[]
  currentEpisodeId?: string | null
  onSelectEpisode?: (id: string) => void
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
  cta,
  episodes,
  currentEpisodeId,
  onSelectEpisode,
  onDeleteEpisode,
}: SideNavProps) {
  const initial = projectTitle.trim().charAt(0) || 'N'
  return (
    <nav className="flex w-sidebar shrink-0 flex-col border-outline-variant/20 border-r bg-surface-container-low py-6 font-sans">
      {/* プロジェクト見出し */}
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

      {/* ナビ */}
      <div className="space-y-1 px-4">
        <NavRow
          icon={Library}
          label="コレクション"
          active={active === 'collection'}
          onClick={onNavigateCollection}
        />
        <NavRow
          icon={BookOpen}
          label="エピソード"
          active={active === 'episodes'}
          disabled={active !== 'episodes'}
        />
        <NavRow icon={FlaskConical} label="リサーチ" badge="準備中" />
        <NavRow icon={Archive} label="アーカイブ" badge="準備中" />
      </div>

      {/* 話サブリスト（エディタのみ） */}
      {episodes && episodes.length > 0 ? (
        <div className="mt-6 min-h-0 flex-1 px-8">
          <div className="mb-3 font-sans text-[11px] text-on-surface-variant/70 uppercase tracking-widest">
            現在の草稿
          </div>
          <ScrollArea className="h-full">
            <ul className="ml-2 space-y-1 border-outline-variant/30 border-l pl-4">
              {episodes.map((e) => {
                const isCurrent = e.id === currentEpisodeId
                return (
                  <li key={e.id} className="group relative flex items-center gap-1">
                    {isCurrent ? (
                      <span className="-left-[17px] -translate-y-1/2 absolute top-1/2 size-1.5 rounded-full bg-primary" />
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
      ) : (
        <div className="flex-1" />
      )}

      {/* フッター */}
      <div className="mt-8 space-y-1 px-4">
        <NavRow icon={Settings} label="設定" disabled />
        <NavRow icon={CircleHelp} label="ヘルプ" disabled />
      </div>
    </nav>
  )
}
