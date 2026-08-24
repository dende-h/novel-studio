import { ArrowLeft, BookOpen, Lock, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  type Appearances,
  categoriesOf,
  matchesQuery,
  publicTextOf,
  resolvedNameSet,
  resolveRef,
  sortEntries,
} from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { thumbnailToDataUrl } from '@/ui/_utils/imageResizer'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import {
  GLOSSARY_CATEGORIES,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryEntryDetail } from '@/ui/components/GlossaryPeek/entry-detail'
import { NotationField } from '@/ui/components/NotationField/notation-field'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'

/**
 * 用語集のメイン画面。**左：項目の一覧（検索・カテゴリ絞り込み）／右：選んだ項目の編集**の
 * 二枚看板（世界観設定・ビートシートと同じ型）。
 *
 * 以前はカード一覧＋閲覧・編集モーダルだったが、用語集は「読みながら直す・項目を渡り歩く」
 * 時間が長い画面なので、1 件ごとにダイアログを開閉するより、切り替えながらその場で書ける
 * 方が速い。公開情報・作者メモは記法つき（@ / [[ サジェスト・プレビュー）。プレビューの
 * [[用語]] クリックは**右のチラ見ドロワー**で開く（本文エディタの用語集パネルと同じ見方）。
 * 編集対象は切り替えない＝書いている場所を失わない。切り替えたいときはチラ見の
 * 「この項目を編集」か、左の一覧・検索から。
 *
 * 狭い画面（md 未満）では一覧と編集を切り替え式にする（選ぶと編集・← で一覧へ戻る）。
 */
interface GlossaryViewProps {
  entries: GlossaryEntry[]
  /** 開いている作品のタイトル（サブタイトル表示用・任意）。 */
  workTitle?: string
  /** entry の登場話数・参照回数（findAppearances を App が束縛して渡す）。 */
  getAppearances: (entry: GlossaryEntry) => Appearances
  /** 新規作成（名前だけで作る）。作成した entry の id を返す。重複などは reject。 */
  onCreate: (name: string) => Promise<string>
  onUpdate: (id: string, values: GlossaryFormValues) => Promise<void> | void
  onRename: (id: string, newName: string, opts: { rewriteBody: boolean }) => Promise<void> | void
  onDelete: (id: string) => void
  /** サジェストの「＋ 用語集に登録」（名前だけのクイック作成・作成した名前を返す）。 */
  onCreateEntry?: (name: string) => Promise<string | null>
}

export function GlossaryView({
  entries,
  workTitle,
  getAppearances,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
  onCreateEntry,
}: GlossaryViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 新規作成ダイアログ。文字列は名前のプリフィル（プレビューの未解決 [[用語]] クリックから）。
  const [createOpen, setCreateOpen] = useState<string | null>(null)
  // プレビューの [[用語]] クリックで開くチラ見ドロワーの対象。
  const [peekId, setPeekId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GlossaryEntry | null>(null)

  const categories = useMemo(() => categoriesOf(entries), [entries])
  const visible = useMemo(() => {
    const byQuery = entries.filter((e) => matchesQuery(e, query))
    const byCat = category ? byQuery.filter((e) => (e.category ?? '').trim() === category) : byQuery
    return sortEntries(byCat)
  }, [entries, query, category])
  const resolvedNames = useMemo(() => resolvedNameSet(entries), [entries])

  const selected = selectedId ? (entries.find((e) => e.id === selectedId) ?? null) : null
  const peeked = peekId ? (entries.find((e) => e.id === peekId) ?? null) : null
  // 選択・チラ見していた項目が消えたら（削除・同期）閉じる＝空の面が残らない。
  useEffect(() => {
    if (selectedId && !entries.some((e) => e.id === selectedId)) setSelectedId(null)
  }, [selectedId, entries])
  useEffect(() => {
    if (peekId && !entries.some((e) => e.id === peekId)) setPeekId(null)
  }, [peekId, entries])

  // プレビューの [[用語]] クリック：居る項目は右のチラ見で開く（編集対象は切り替えない＝
  // 書いている場所を失わない）。無い語は名前入りで新規作成へ。
  const jumpToRef = (name: string) => {
    const target = resolveRef(name, entries)
    if (target) setPeekId(target.id)
    else setCreateOpen(name)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col gap-3 px-5 pt-7 md:px-8">
        {/* ヘッダ（1 行に畳む＝下の一覧と編集面に高さを渡す） */}
        <header className="shrink-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-semibold font-serif text-[24px] text-on-surface">用語集</h1>
            <p className="text-[12.5px] text-on-surface-variant">
              {workTitle ? `「${workTitle}」・${entries.length}項目` : `${entries.length}項目`}
            </p>
          </div>
          {/* 用語集は公開される器。設定やネタバレの行き先を最初に示して、書き分けで迷わせない。 */}
          <p className="mt-0.5 text-[12px] text-on-surface-variant/70">
            本文やプロットから @ で呼び出せる、作品の事典です。投稿すると読者にも見えます
            （作品の決め事やネタバレは、プロットの「世界観設定」へ）。
          </p>
        </header>

        <div className="relative flex min-h-0 flex-1 items-stretch gap-6">
          {/* 左：検索・絞り込み・項目一覧。狭幅では選択中は隠して編集面に譲る。 */}
          <nav
            aria-label="用語集の項目"
            className={cn(
              'w-full flex-col gap-2.5 pb-6 md:flex md:w-[17rem] md:shrink-0',
              selected ? 'hidden' : 'flex',
            )}
          >
            <Button onClick={() => setCreateOpen('')} size="sm" className="w-full gap-1.5">
              <Plus className="size-4" />
              新しく登録
            </Button>
            <div className="relative">
              <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-on-surface-variant/60" />
              <Input
                aria-label="用語集を検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・別名・読みで検索"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            {categories.length > 0 ? (
              <fieldset
                className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
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
            {visible.length === 0 ? (
              <p className="px-1 py-8 text-center text-[12.5px] text-on-surface-variant">
                {entries.length === 0
                  ? 'まだ用語集がありません。「新しく登録」または本文の @ から追加できます。'
                  : '条件に合う項目がありません。'}
              </p>
            ) : (
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {visible.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    active={entry.id === selectedId}
                    used={getAppearances(entry).refCount > 0}
                    onClick={() => setSelectedId(entry.id)}
                  />
                ))}
              </ul>
            )}
          </nav>

          {/* 右：選んだ項目の編集面。狭幅では未選択のとき隠して一覧に譲る。 */}
          <section
            aria-label="項目の編集"
            className={cn(
              'min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-10 md:flex',
              selected ? 'flex' : 'hidden',
            )}
          >
            {selected ? (
              <EntryEditor
                key={selected.id}
                entry={selected}
                appearances={getAppearances(selected)}
                entries={entries}
                resolvedNames={resolvedNames}
                onUpdate={onUpdate}
                onRename={onRename}
                onRequestDelete={() => setDeleteTarget(selected)}
                onCreateEntry={onCreateEntry}
                onRefClick={jumpToRef}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-6">
                <p className="max-w-[26rem] text-center text-[13px] text-on-surface-variant/70 leading-relaxed">
                  左の一覧から項目を選ぶと、ここで編集できます。
                  <br />
                  公開情報・作者メモでは @ や [[ で他の用語を呼び出せます。
                </p>
              </div>
            )}
          </section>

          {/* プレビューの [[用語]] クリックで開くチラ見ドロワー（本文エディタの用語集パネルと
              同じ見方）。編集面はそのまま＝参照しながら書き続けられる。狭幅では編集面を
              潰さないよう右からかぶせる（md 以上は 3 カラム目として並ぶ）。 */}
          {peeked ? (
            <aside
              aria-label="用語のチラ見"
              className="absolute inset-y-0 right-0 z-10 flex w-[min(300px,85vw)] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans shadow-xl md:static md:shadow-none"
            >
              <div className="flex shrink-0 items-center justify-between border-outline-variant/30 border-b px-4 py-3">
                <span className="font-medium text-[12px] text-on-surface tracking-widest">
                  用語のチラ見
                </span>
                <button
                  type="button"
                  onClick={() => setPeekId(null)}
                  aria-label="チラ見を閉じる"
                  className="-mr-1.5 flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:text-on-surface"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-2.5 px-4 py-4">
                  <GlossaryEntryDetail
                    entry={peeked}
                    appearances={getAppearances(peeked)}
                    editLabel="この項目を編集"
                    onEdit={() => {
                      setSelectedId(peeked.id)
                      setPeekId(null)
                    }}
                  />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {/* 新規作成（名前だけ決めて、続きは編集面で書く） */}
      <CreateEntryDialog
        open={createOpen !== null}
        initialName={createOpen ?? ''}
        onOpenChange={(o) => {
          if (!o) setCreateOpen(null)
        }}
        onCreate={async (name) => {
          const id = await onCreate(name)
          setSelectedId(id)
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
        'rounded-full border px-2.5 py-2 font-sans text-[11.5px] transition-colors md:py-0.5',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high',
      )}
    >
      {label}
    </button>
  )
}

/** 左カラムの 1 行（サムネ or 頭文字・名前・分類と使用状況）。 */
function EntryRow({
  entry,
  active,
  used,
  onClick,
}: {
  entry: GlossaryEntry
  active: boolean
  used: boolean
  onClick: () => void
}) {
  const initial = entry.name.trim().charAt(0) || '？'
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        aria-label={`「${entry.name}」を編集`}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
          active
            ? 'bg-secondary-container text-on-secondary-container'
            : 'text-on-surface hover:bg-surface-container-high',
        )}
      >
        {entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt=""
            className="size-8 shrink-0 rounded-md border border-outline-variant/30 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent font-serif text-[13px] text-primary"
          >
            {initial}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-[13px]', active ? 'font-medium' : '')}>
            {entry.name}
          </span>
          <span className="truncate text-[10.5px] text-on-surface-variant/70">
            {[entry.category ?? '未分類', used ? '' : '未使用'].filter(Boolean).join(' ・ ')}
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * 右カラムの編集面。モーダルの「保存する」は無く、各フィールドが blur（欄を離れる）で
 * その場で確定する＝世界観設定と同じ書き味。名前・別名の衝突（D-GLOS-UNIQUE）は
 * reject をここで受けてエラー表示し、入力は保つ（打ち直せる）。
 */
function EntryEditor({
  entry,
  appearances,
  entries,
  resolvedNames,
  onUpdate,
  onRename,
  onRequestDelete,
  onCreateEntry,
  onRefClick,
  onBack,
}: {
  entry: GlossaryEntry
  appearances: Appearances
  entries: GlossaryEntry[]
  resolvedNames: Set<string>
  onUpdate: (id: string, values: GlossaryFormValues) => Promise<void> | void
  onRename: (id: string, newName: string, opts: { rewriteBody: boolean }) => Promise<void> | void
  onRequestDelete: () => void
  onCreateEntry?: (name: string) => Promise<string | null>
  onRefClick: (name: string) => void
  onBack: () => void
}) {
  const uid = useId()
  const [error, setError] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)

  /** 現在値から GlossaryFormValues を組む（1 フィールドずつ差し替えて確定する土台）。 */
  const valuesOf = (e: GlossaryEntry): GlossaryFormValues => ({
    name: e.name,
    aliases: e.aliases,
    category: e.category ?? '',
    reading: e.reading ?? '',
    // 公開情報は概要＋旧・詳細の結合＝一度でも保存すれば summary へ一本化される。
    summary: publicTextOf(e),
    authorNote: e.authorNote ?? '',
    thumbnail: e.thumbnail ?? '',
  })

  const commitField = async (patch: Partial<GlossaryFormValues>) => {
    setError(null)
    try {
      await onUpdate(entry.id, { ...valuesOf(entry), ...patch })
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const commitName = async (name: string) => {
    if (name === entry.name) return
    setError(null)
    try {
      await onRename(entry.id, name, { rewriteBody: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : '名前の変更に失敗しました')
    }
  }

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    setImageBusy(true)
    setError(null)
    try {
      await commitField({ thumbnail: await thumbnailToDataUrl(file) })
    } catch {
      setError('画像の読み込みに失敗しました')
    } finally {
      setImageBusy(false)
    }
  }

  // 既存データに固定リスト外のカテゴリ（旧・自由入力）があれば選択肢に含めて保全する。
  const legacyCategory =
    (entry.category ?? '') !== '' &&
    !(GLOSSARY_CATEGORIES as readonly string[]).includes(entry.category ?? '')
      ? (entry.category as string)
      : null

  const used = appearances.refCount > 0

  return (
    <div className="flex flex-col gap-4">
      {/* 狭幅だけの「← 一覧へ」。md 以上は一覧が常に見えているので出さない。 */}
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1 rounded-md py-1 pr-2 text-[12.5px] text-on-surface-variant transition-colors hover:text-primary md:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        一覧へ
      </button>

      {/* 名前＋削除。名前は blur で確定（旧名は自動で別名に残り、本文の参照は解決され続ける）。 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <NameInput value={entry.name} onCommit={(v) => void commitName(v)} />
          <p className="mt-1 text-[11px] text-on-surface-variant/60">
            名前を変えても、旧名は自動で別名に残り本文中の参照はそのまま解決されます ・{' '}
            {used ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場` : '未使用'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRequestDelete}
          aria-label={`「${entry.name}」を削除`}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-on-surface-variant/70 transition-colors hover:bg-error-container hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
          削除
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* メタ情報（読み・カテゴリ・別名・サムネ）。狭幅で 2 列固定にすると潰れるので 1 列へ落とす。 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-reading`}>読み（任意）</Label>
          <CommitInput
            id={`${uid}-reading`}
            value={entry.reading ?? ''}
            onCommit={(v) => void commitField({ reading: v.trim() })}
            placeholder="ゆぐどらしる"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-category`}>カテゴリ</Label>
          <select
            id={`${uid}-category`}
            value={entry.category ?? ''}
            onChange={(e) => void commitField({ category: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-surface-container-lowest px-3 font-sans text-base text-on-surface outline-none transition-colors focus:border-primary md:text-sm"
          >
            <option value="">未分類</option>
            {GLOSSARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {legacyCategory ? <option value={legacyCategory}>{legacyCategory}</option> : null}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-aliases`}>別名（読点区切り・任意）</Label>
        <CommitInput
          id={`${uid}-aliases`}
          value={entry.aliases.join('、')}
          onCommit={(v) => void commitField({ aliases: parseAliases(v) })}
          placeholder="世界樹、ワールドツリー"
        />
      </div>

      {/* 公開情報（読者に見える）。記法つき＝@ / [[ サジェストとプレビュー。 */}
      <section className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-[13px] text-on-surface">公開情報</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-container px-2 py-0.5 font-medium text-[10.5px] text-on-primary-container">
            <BookOpen className="size-2.5" aria-hidden />
            読者に見えます
          </span>
        </div>
        <NotationField
          value={publicTextOf(entry)}
          onCommit={(v) => void commitField({ summary: v.trim() })}
          placeholder="一行の要約から、来歴・見た目などの詳しい説明まで、読者に見せる文をここへ"
          ariaLabel="公開情報"
          resolvedNames={resolvedNames}
          glossary={entries}
          onCreateEntry={onCreateEntry}
          onRefClick={onRefClick}
          textareaClassName="min-h-36 text-[13.5px]"
        />
        <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
          公開サイトへ投稿すると読者にも見えます（その用語が出てくる話まで読んだ読者だけに開きます）。
          @ または [[ で他の用語を呼び出せます。プレビューの緑の語はクリックで右にチラ見が開きます。
        </p>
      </section>

      {/* 作者メモ（非公開）。 */}
      <section className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-[13px] text-on-surface">作者メモ</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-medium text-[10.5px] text-on-secondary-container">
            <Lock className="size-2.5" aria-hidden />
            公開されません
          </span>
        </div>
        <NotationField
          value={entry.authorNote ?? ''}
          onCommit={(v) => void commitField({ authorNote: v.trim() })}
          placeholder="この人物の正体、この場所で後に起きること——まだ読者に見せないこと"
          ariaLabel="作者メモ"
          resolvedNames={resolvedNames}
          glossary={entries}
          onCreateEntry={onCreateEntry}
          onRefClick={onRefClick}
          textareaClassName="min-h-24 text-[13.5px]"
        />
        <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
          この欄だけは投稿時に取り除かれます。作品全体の決め事や設定ルールは、プロットの
          「世界観設定」へ書くとまとまります。
        </p>
      </section>

      {/* サムネイル。 */}
      <section className="space-y-1.5">
        <Label htmlFor={`${uid}-thumbnail`}>サムネイル画像（任意）</Label>
        <div className="flex items-center gap-3">
          {entry.thumbnail ? (
            <ZoomableImage
              src={entry.thumbnail}
              alt={`${entry.name}のサムネイル`}
              className="size-16 rounded-md border border-outline-variant/30 object-cover"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 border-dashed text-on-surface-variant/40 text-xs">
              なし
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <input
              id={`${uid}-thumbnail`}
              type="file"
              accept="image/*"
              onChange={(e) => {
                void onPickImage(e.target.files?.[0])
                e.target.value = ''
              }}
              className="block w-full text-on-surface-variant text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-sm hover:file:bg-secondary/80"
            />
            <div className="flex items-center gap-3 text-on-surface-variant/70 text-xs">
              <span>{imageBusy ? '処理中…' : '正方形に切り抜いて保存'}</span>
              {entry.thumbnail ? (
                <button
                  type="button"
                  onClick={() => void commitField({ thumbnail: '' })}
                  className="text-destructive hover:underline"
                >
                  削除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/** 別名入力（カンマ／読点／改行区切り）を配列へ。trim・空除去・重複除去。 */
function parseAliases(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,、\n]/)) {
    const a = part.trim()
    if (a !== '' && !out.includes(a)) out.push(a)
  }
  return out
}

/** blur / Enter で確定する 1 行入力（PremiseInput と同じ流儀・Esc で戻す）。 */
function CommitInput({
  id,
  value,
  onCommit,
  placeholder,
}: {
  id?: string
  value: string
  onCommit: (v: string) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <Input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      placeholder={placeholder}
    />
  )
}

/** 名前の入力（blur で確定・空は元へ戻す）。見出しの見た目のまま編集できる。 */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        const v = draft.trim()
        if (v === '') setDraft(value)
        else if (v !== value) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="名前"
      className="w-full rounded-md bg-transparent px-1 font-semibold font-serif text-[20px] text-on-surface outline-none transition-colors hover:bg-surface-container-high focus:bg-surface-container-high"
    />
  )
}

/**
 * 新規作成ダイアログ（名前だけ）。読み・分類・説明は作成後の編集面でそのまま書ける。
 * 重複（D-GLOS-UNIQUE）は onCreate の reject を受けてダイアログ内に表示する。
 */
function CreateEntryDialog({
  open,
  initialName,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  initialName: string
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 開いた瞬間だけ初期化（表示中に親が再レンダーされても入力を巻き戻さない）。
  const initialRef = useRef(initialName)
  initialRef.current = initialName
  useEffect(() => {
    if (!open) return
    setName(initialRef.current)
    setError(null)
    setBusy(false)
  }, [open])

  const submit = async () => {
    const v = name.trim()
    if (v === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(v)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif text-on-surface">用語集に登録</DialogTitle>
          <DialogDescription className="sr-only">
            名前を決めて項目を作成します。説明などは作成後にそのまま書けます。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-2">
              <Label htmlFor="glossary-create-name">名前</Label>
              <Input
                id="glossary-create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：ユグドラシル"
                autoFocus
              />
              <p className="text-[11.5px] text-on-surface-variant/70">
                読み・カテゴリ・説明は、作成したあとそのまま書けます。
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={name.trim() === '' || busy}>
              作成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
