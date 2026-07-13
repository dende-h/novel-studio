import { Pencil, Plus, Search, Tag, Trash2, Type } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type Appearances, categoriesOf, matchesQuery, sortEntries } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import {
  GlossaryEntryForm,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'
import { RenameEntryDialog } from './rename-entry-dialog'

interface GlossaryViewProps {
  entries: GlossaryEntry[]
  /** 開いている作品のタイトル（サブタイトル表示用・任意）。 */
  workTitle?: string
  /** entry の登場話数・参照回数（findAppearances を App が束縛して渡す）。 */
  getAppearances: (entry: GlossaryEntry) => Appearances
  onCreate: (values: GlossaryFormValues) => Promise<void> | void
  onUpdate: (id: string, values: GlossaryFormValues) => Promise<void> | void
  onRename: (id: string, newName: string, opts: { rewriteBody: boolean }) => Promise<void> | void
  onDelete: (id: string) => void
}

/** @参照／オブジェクト辞書のメイン画面（一覧・検索・カテゴリ絞り込み・CRUD）。 */
export function GlossaryView({
  entries,
  workTitle,
  getAppearances,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
}: GlossaryViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<GlossaryEntry | null>(null)
  const [renameTarget, setRenameTarget] = useState<GlossaryEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GlossaryEntry | null>(null)

  const categories = useMemo(() => categoriesOf(entries), [entries])
  const visible = useMemo(() => {
    const byQuery = entries.filter((e) => matchesQuery(e, query))
    const byCat = category ? byQuery.filter((e) => (e.category ?? '').trim() === category) : byQuery
    return sortEntries(byCat)
  }, [entries, query, category])

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-8 py-9 pb-16 md:px-10">
        {/* ヘッダ */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-semibold font-serif text-[26px] text-on-surface">図鑑</h1>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              {workTitle
                ? `「${workTitle}」の人物・場所・用語 ・ ${entries.length}項目`
                : entries.length > 0
                  ? `${entries.length}項目`
                  : '本文に [[名前]] で参照できる項目'}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            新しく登録
          </Button>
        </header>

        {/* 検索＋カテゴリ絞り込み */}
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-on-surface-variant/60" />
          <Input
            aria-label="図鑑を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・別名・読みで検索"
            className="h-[42px] pl-9"
          />
        </div>
        {categories.length > 0 ? (
          <fieldset
            className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
            aria-label="カテゴリで絞り込み"
          >
            <FilterChip
              label="すべて"
              active={category === null}
              onClick={() => setCategory(null)}
            />
            {categories.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={category === c}
                onClick={() => setCategory((cur) => (cur === c ? null : c))}
              />
            ))}
          </fieldset>
        ) : null}

        {/* 一覧 */}
        {visible.length === 0 ? (
          <p className="py-14 text-center text-[13px] text-on-surface-variant">
            {entries.length === 0
              ? 'まだ図鑑がありません。「新しく登録」または本文の @ から追加できます。'
              : '条件に合う項目がありません。'}
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
            {visible.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                appearances={getAppearances(entry)}
                onEdit={() => setEditTarget(entry)}
                onRename={() => setRenameTarget(entry)}
                onDelete={() => setDeleteTarget(entry)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 新規作成 */}
      <GlossaryEntryForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        categories={categories}
        onSubmit={onCreate}
      />
      {/* 詳細編集（name 以外） */}
      <GlossaryEntryForm
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        mode="edit"
        initial={editTarget ?? undefined}
        categories={categories}
        onSubmit={(values) => {
          if (editTarget) return onUpdate(editTarget.id, values)
        }}
      />
      {/* 改名 */}
      <RenameEntryDialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null)
        }}
        currentName={renameTarget?.name ?? ''}
        onSubmit={(newName, opts) => {
          if (renameTarget) return onRename(renameTarget.id, newName, opts)
        }}
      />
      {/* 削除確認 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="この項目を削除しますか？"
        description={
          deleteTarget
            ? `「${deleteTarget.name}」を図鑑から削除します。本文中の参照は残り、未解決リンクになります。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id)
        }}
      />
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 font-sans text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high',
      )}
    >
      {label}
    </button>
  )
}

function EntryCard({
  entry,
  appearances,
  onEdit,
  onRename,
  onDelete,
}: {
  entry: GlossaryEntry
  appearances: Appearances
  onEdit: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const used = appearances.refCount > 0
  const initial = entry.name.trim().charAt(0) || '？'
  return (
    <li className="group flex flex-col gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5 transition-all hover:border-outline-variant/50 hover:shadow-sm">
      <div className="flex items-center gap-3">
        {/* 頭文字タイル（画像があれば画像） */}
        {entry.thumbnail ? (
          <ZoomableImage
            src={entry.thumbnail}
            alt={entry.name}
            className="size-[52px] rounded-lg border border-outline-variant/30 object-cover"
            wrapperClassName="shrink-0"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-[52px] shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-accent font-serif text-[20px] text-primary"
          >
            {initial}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-semibold font-serif text-[16px] text-on-surface">
              {entry.name}
            </h3>
            {entry.reading ? (
              <span className="shrink-0 text-[11px] text-on-surface-variant/70">
                {entry.reading}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {entry.category ? (
              <Badge
                variant="secondary"
                className="gap-1 bg-primary-container text-on-primary-container"
              >
                <Tag className="size-3" />
                {entry.category}
              </Badge>
            ) : null}
            <span className="text-[11px] text-on-surface-variant/70">
              {used
                ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場`
                : '未使用'}
            </span>
          </div>
        </div>
        {/* 行内アクション（ホバー/フォーカスで出現） */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconAction label={`「${entry.name}」を編集`} onClick={onEdit}>
            <Pencil className="size-4" />
          </IconAction>
          <IconAction label={`「${entry.name}」を改名`} onClick={onRename}>
            <Type className="size-4" />
          </IconAction>
          <IconAction label={`「${entry.name}」を削除`} onClick={onDelete} destructive>
            <Trash2 className="size-4" />
          </IconAction>
        </div>
      </div>
      <p className="truncate text-[12px] text-on-surface-variant">
        別名: {entry.aliases.length > 0 ? entry.aliases.join('、') : 'なし'}
      </p>
      <p className="line-clamp-2 min-h-[40px] text-[12px] text-on-surface-variant leading-relaxed">
        {entry.summary || '説明はまだありません。'}
      </p>
    </li>
  )
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 text-on-surface-variant/70 transition-colors hover:bg-surface-container-high',
        destructive ? 'hover:text-destructive' : 'hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}
