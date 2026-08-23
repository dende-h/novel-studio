import { Plus, Search, Tag } from 'lucide-react'
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
import { GlossaryDetailDialog } from './glossary-detail-dialog'

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
  // カード押下で開く閲覧ダイアログ。そこから編集/削除へ分岐する。
  const [viewTarget, setViewTarget] = useState<GlossaryEntry | null>(null)
  const [editTarget, setEditTarget] = useState<GlossaryEntry | null>(null)
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
            <h1 className="font-semibold font-serif text-[26px] text-on-surface">用語集</h1>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              {workTitle
                ? `「${workTitle}」の人物・場所・用語・アイテム ・ ${entries.length}項目`
                : entries.length > 0
                  ? `${entries.length}項目`
                  : '本文に [[名前]] で参照できる項目'}
            </p>
            {/* 用語集は公開される器。設定やネタバレの行き先を最初に示して、書き分けで迷わせない。 */}
            <p className="mt-1 text-[12px] text-on-surface-variant/70 leading-relaxed">
              本文やプロットから @ で呼び出せる、作品の事典です。投稿すると読者にも見えます
              （作品の決め事やネタバレは、プロットの「世界観設定」へ）。
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
            aria-label="用語集を検索"
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
              ? 'まだ用語集がありません。「新しく登録」または本文の @ から追加できます。'
              : '条件に合う項目がありません。'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                appearances={getAppearances(entry)}
                onOpen={() => setViewTarget(entry)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 閲覧（カード押下で開く）。ここから編集・削除へ分岐する。 */}
      <GlossaryDetailDialog
        open={viewTarget !== null}
        onOpenChange={(o) => {
          if (!o) setViewTarget(null)
        }}
        entry={viewTarget}
        appearances={viewTarget ? getAppearances(viewTarget) : { episodeIds: [], refCount: 0 }}
        onEdit={() => {
          setEditTarget(viewTarget)
          setViewTarget(null)
        }}
        onDelete={() => {
          setDeleteTarget(viewTarget)
          setViewTarget(null)
        }}
      />
      {/* 新規作成 */}
      <GlossaryEntryForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={onCreate}
      />
      {/* 編集（名前の変更も同じダイアログで行う。変更時は旧名が自動で別名に残る） */}
      <GlossaryEntryForm
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        mode="edit"
        initial={editTarget ?? undefined}
        onSubmit={async (values) => {
          if (!editTarget) return
          // 改名を先に確定（衝突は reject されダイアログに表示）、その後にフィールド更新。
          if (values.name !== editTarget.name) {
            await onRename(editTarget.id, values.name, { rewriteBody: false })
          }
          await onUpdate(editTarget.id, values)
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
            ? `「${deleteTarget.name}」を用語集から削除します。本文中の参照は残り、未解決リンクになります。`
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
        // タッチでは 44px 目安のタップ領域を確保し、ポインタ環境では従来の密度に戻す。
        'rounded-full border px-3 py-2.5 font-sans text-xs transition-colors md:py-1',
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
  onOpen,
}: {
  entry: GlossaryEntry
  appearances: Appearances
  onOpen: () => void
}) {
  const used = appearances.refCount > 0
  const initial = entry.name.trim().charAt(0) || '？'
  return (
    <li>
      {/* カード全体を押すと閲覧ダイアログが開く（そこから編集・削除へ）。 */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`「${entry.name}」の詳細を開く`}
        className="flex w-full gap-4 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4 text-left transition-all hover:border-outline-variant/50 hover:shadow-sm focus-visible:border-primary focus-visible:outline-none"
      >
        {/* サムネ（拡大は詳細ダイアログ内で）。無ければ頭文字タイル。 */}
        {entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt=""
            className="size-14 shrink-0 self-start rounded-lg border border-outline-variant/30 object-cover sm:size-20"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center self-start rounded-lg border border-outline-variant/30 bg-accent font-serif text-[20px] text-primary sm:size-20 sm:text-[26px]"
          >
            {initial}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
          <div className="flex min-w-0 items-center gap-2">
            {entry.category ? (
              <Badge
                variant="secondary"
                className="shrink-0 gap-1 bg-primary-container text-on-primary-container"
              >
                <Tag className="size-3" />
                {entry.category}
              </Badge>
            ) : null}
            <span className="truncate text-[11px] text-on-surface-variant/70">
              {used
                ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場`
                : '未使用'}
            </span>
          </div>
          <p className="truncate text-[12px] text-on-surface-variant">
            別名: {entry.aliases.length > 0 ? entry.aliases.join('、') : 'なし'}
          </p>
          <p className="line-clamp-2 text-[12px] text-on-surface-variant leading-relaxed">
            {entry.summary || '説明はまだありません。'}
          </p>
        </div>
      </button>
    </li>
  )
}
