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
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { RenameEntryDialog } from './rename-entry-dialog'

interface GlossaryViewProps {
  entries: GlossaryEntry[]
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
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      {/* ヘッダ */}
      <header className="flex items-center justify-between gap-4 border-outline-variant/20 border-b px-8 py-5">
        <div>
          <h1 className="font-bold font-serif text-on-surface text-xl">辞書</h1>
          <p className="text-on-surface-variant text-xs">
            {entries.length > 0 ? `${entries.length} 項目` : '本文に [[名前]] で参照できる項目'}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          新規
        </Button>
      </header>

      {/* 検索＋カテゴリ絞り込み */}
      <div className="space-y-3 border-outline-variant/20 border-b px-8 py-4">
        <div className="relative">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-on-surface-variant/60" />
          <Input
            aria-label="辞書を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・別名・読みで検索"
            className="pl-9"
          />
        </div>
        {categories.length > 0 ? (
          <fieldset
            className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
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
      </div>

      {/* 一覧 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-8 py-6">
          {visible.length === 0 ? (
            <p className="py-16 text-center text-on-surface-variant text-sm">
              {entries.length === 0
                ? 'まだ辞書がありません。「新規」または本文の @ から追加できます。'
                : '該当する項目がありません。'}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
      </ScrollArea>

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
            ? `「${deleteTarget.name}」を辞書から削除します。本文中の参照は残り、未解決リンクになります。`
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
          ? 'border-primary bg-primary/10 text-primary'
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
  return (
    <li className="group flex flex-col gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-4 transition-colors hover:border-outline-variant/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-medium font-serif text-base text-on-surface">
              {entry.name}
            </h3>
            {entry.reading ? (
              <span className="shrink-0 text-on-surface-variant/70 text-xs">{entry.reading}</span>
            ) : null}
          </div>
          {entry.category ? (
            <Badge variant="secondary" className="mt-1 gap-1">
              <Tag className="size-3" />
              {entry.category}
            </Badge>
          ) : null}
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
      {entry.aliases.length > 0 ? (
        <p className="truncate text-on-surface-variant text-xs">別名: {entry.aliases.join('、')}</p>
      ) : null}
      {entry.summary ? (
        <p className="line-clamp-2 text-on-surface-variant text-sm">{entry.summary}</p>
      ) : null}
      <p className="mt-auto text-on-surface-variant/70 text-xs">
        {used ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場` : '未使用'}
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
