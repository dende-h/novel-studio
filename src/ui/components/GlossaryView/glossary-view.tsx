import { ArrowLeft, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  type Appearances,
  categoriesOf,
  matchesQuery,
  PERSON_CATEGORY,
  publicTextOf,
  resolvedNameSet,
  resolveRef,
  sortEntries,
} from '@/core/glossary'
import {
  DIALOG_VERSION,
  type DialogSummary,
  dialogRecordDiff,
  dialogSummaryOf,
  parseAliasInput,
} from '@/core/glossary/dialog'
import type { DialogSession } from '@/core/glossary/dialogSession'
import type { DialogAnswer, GlossaryEntry } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import { cn } from '@/lib/utils'
import { thumbnailToDataUrl } from '@/ui/_utils/imageResizer'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import {
  formValuesToFieldPatch,
  GLOSSARY_CATEGORIES,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryEntryDetail } from '@/ui/components/GlossaryPeek/entry-detail'
import { DialogNoteSection } from '@/ui/components/GlossaryView/dialog-note-section'
import { DialogPane } from '@/ui/components/GlossaryView/dialog-pane'
import { SpriteSection } from '@/ui/components/GlossaryView/sprite-section'
import { VisibilityLabel } from '@/ui/components/GlossaryView/visibility-label'
import { NotationField } from '@/ui/components/NotationField/notation-field'
import { NotationHelpButton } from '@/ui/components/NotationField/notation-help'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'
import { applyGlossaryFieldPatch, type NewGlossaryEntry } from '@/ui/store/editorStore'

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
 * 右ペインは「フォーム｜対話」の二面（11-glossary-dialog.md）。対話は決まった質問に一問ずつ
 * 答えて項目を育てる入口で、「＋ 新しく登録」は対話で開く（D-DLG-ENTRY）。新規は**下書き**として
 * 手元に置き、「用語集に登録」で初めて保存する。既存の項目はフォームで開く（今までの操作は変えない）。
 *
 * 狭い画面（md 未満）では一覧と編集を切り替え式にする（選ぶと編集・← で一覧へ戻る）。
 */

/** 対話ペインが保存する差分。渡した欄だけ書き換える（省略＝据え置き）。 */
export interface GlossaryDialogPatch {
  /** 対話ノートの鍵ごとの差分（`null`＝その鍵を削除）。他の鍵は据え置き。 */
  dialogPatch?: Record<string, DialogAnswer | null>
  dialogVersion?: number
  category?: string
  /** 公開情報（まとめの下書きを入れたとき）。旧・詳細（body）は畳む。 */
  summary?: string
}

interface GlossaryViewProps {
  entries: GlossaryEntry[]
  /** 開いている作品のタイトル（サブタイトル表示用・任意）。 */
  workTitle?: string
  /** entry の登場話数・参照回数（findAppearances を App が束縛して渡す）。 */
  getAppearances: (entry: GlossaryEntry) => Appearances
  /** 新規作成（下書きの欄をそのまま渡す。空の欄の畳み方は store が持つ）。作成した entry の id を返す。重複などは reject。 */
  onCreate: (input: NewGlossaryEntry) => Promise<string>
  onUpdate: (id: string, values: GlossaryFormValues) => Promise<void> | void
  /**
   * 対話ペインからの保存。**変わった欄だけ**のパッチ（対話ノート・分類・公開情報）＝フォームの
   * 他の欄や同期で届いた値を巻き込まない（CLAUDE.md「1欄だけの更新で他の欄を落とさない」）。
   */
  onUpdateDialog: (id: string, patch: GlossaryDialogPatch) => Promise<void> | void
  onRename: (id: string, newName: string, opts: { rewriteBody: boolean }) => Promise<void> | void
  onDelete: (id: string) => void
  /** サジェストの「＋ 用語集に登録」（名前だけのクイック作成・作成した名前を返す）。 */
  onCreateEntry?: (name: string) => Promise<string | null>
  /** ゲーム素材の置き場所（渡されたときだけ、人物 entry に「立ち絵」欄が出る。PC 限定）。 */
  gameAssetRepo?: GameAssetRepository
  /**
   * 登録前の下書きを覚えておく鍵（作品 id）。別の画面へ行って戻っても、同じ作品なら
   * 書きかけの下書きが残る（画面の中だけ・再読み込みでは消える）。省略すると画面を離れたら消える。
   */
  draftKey?: string
}

/** 下書きの id（登録前の新規項目。一覧には出ない）。 */
const DRAFT_ID = '__glossary_draft__'
/** 「対話の途中」の絞り込み（分類チップの末尾・D-DLG-LIST）。 */
const DIALOG_FILTER = '__dialog_in_progress__'

type PaneTab = 'form' | 'dialog'

/** 画面を離れても残す下書きと会話（作品 id → 下書き）。登録・破棄で消す。 */
const keptDrafts = new Map<string, { entry: GlossaryEntry; session?: DialogSession }>()

/** 下書きは作るたびに別の id にする＝捨てて作り直したとき、編集面と対話が新しく立ち上がる。 */
let draftSeq = 0
const newDraft = (name = ''): GlossaryEntry => ({
  id: `${DRAFT_ID}${++draftSeq}`,
  name,
  aliases: [],
  createdAt: 0,
  updatedAt: 0,
})

/** 下書きに何か書いてあるか（捨てるときに確認する）。 */
const draftHasContent = (d: GlossaryEntry) =>
  d.name.trim() !== '' ||
  d.category !== undefined ||
  Object.keys(d.dialog ?? {}).length > 0 ||
  !!d.reading ||
  d.aliases.length > 0 ||
  !!d.summary ||
  !!d.authorNote ||
  !!d.thumbnail

export function GlossaryView({
  entries,
  workTitle,
  getAppearances,
  onCreate,
  onUpdate,
  onUpdateDialog,
  onRename,
  onDelete,
  onCreateEntry,
  gameAssetRepo,
  draftKey,
}: GlossaryViewProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 新規の下書き（登録するまで保存しない）。選択中は一覧の選択を持たない。
  // 画面を離れて戻ったときは、同じ作品の書きかけを戻す。
  const [draft, setDraft] = useState<GlossaryEntry | null>(() =>
    draftKey ? (keptDrafts.get(draftKey)?.entry ?? null) : null,
  )
  // 戻ってきた下書きの会話（スキップの印・答えの吹き出しごと）。その下書き（id）にだけ使う＝
  // 登録・破棄のあと新しく作った下書きには持ち越さない。
  const restored = useRef(draftKey ? keptDrafts.get(draftKey) : undefined)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [tab, setTab] = useState<PaneTab>(() =>
    draftKey && keptDrafts.has(draftKey) ? 'dialog' : 'form',
  )
  useEffect(() => {
    if (!draftKey) return
    if (draft && draftHasContent(draft)) {
      keptDrafts.set(draftKey, { ...(keptDrafts.get(draftKey) ?? {}), entry: draft })
    } else keptDrafts.delete(draftKey)
  }, [draft, draftKey])
  const keepDraftSession = useCallback(
    (session: DialogSession) => {
      const d = draftRef.current
      if (!draftKey || !d) return
      // 下書きがまだ覚えられていない一手目（分類を選んだ直後）でも会話を落とさない。
      keptDrafts.set(draftKey, { entry: keptDrafts.get(draftKey)?.entry ?? d, session })
    },
    [draftKey],
  )
  // 書きかけの下書きがあるあいだは、タブを閉じる・再読み込みの前に確認を出す（残らないので）。
  const draftDirty = draft !== null && draftHasContent(draft)
  useEffect(() => {
    if (!draftDirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftDirty])
  // 書きかけの下書きを捨てて別の操作へ進む確認（進む先を持つ）。
  const [discardThen, setDiscardThen] = useState<(() => void) | null>(null)
  // プレビューの [[用語]] クリックで開くチラ見ドロワーの対象。
  const [peekId, setPeekId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GlossaryEntry | null>(null)

  const categories = useMemo(() => categoriesOf(entries), [entries])
  // 対話の状態は項目ごとに 1 回だけ計算する（一覧の行・絞り込み・件数が共用）。
  const dialogStates = useMemo(() => {
    const map = new Map<string, DialogSummary>()
    for (const e of entries) map.set(e.id, dialogSummaryOf(e))
    return map
  }, [entries])
  const inProgressCount = useMemo(
    () => entries.filter((e) => dialogStates.get(e.id)?.status === 'inProgress').length,
    [entries, dialogStates],
  )
  const visible = useMemo(() => {
    const byQuery = entries.filter((e) => matchesQuery(e, query))
    const byCat =
      category === DIALOG_FILTER
        ? byQuery.filter((e) => dialogStates.get(e.id)?.status === 'inProgress')
        : category
          ? byQuery.filter((e) => (e.category ?? '').trim() === category)
          : byQuery
    return sortEntries(byCat)
  }, [entries, query, category, dialogStates])
  const resolvedNames = useMemo(() => resolvedNameSet(entries), [entries])

  const selected = selectedId ? (entries.find((e) => e.id === selectedId) ?? null) : null
  const current = draft ?? selected
  // 開いている項目の対話の状態（下書きは一覧に無いので、ここで 1 回だけ計算する）
  const currentDialog = useMemo(
    () => (draft ? dialogSummaryOf(draft) : selected ? dialogStates.get(selected.id) : undefined),
    [draft, selected, dialogStates],
  )
  const peeked = peekId ? (entries.find((e) => e.id === peekId) ?? null) : null
  // 選択・チラ見していた項目が消えたら（削除・同期）閉じる＝空の面が残らない。
  useEffect(() => {
    if (selectedId && !entries.some((e) => e.id === selectedId)) setSelectedId(null)
    if (peekId && !entries.some((e) => e.id === peekId)) setPeekId(null)
  }, [entries, selectedId, peekId])
  // 「対話の途中」が空になったら絞り込みを解く（チップも消えるので）。
  useEffect(() => {
    if (category === DIALOG_FILTER && inProgressCount === 0) setCategory(null)
  }, [category, inProgressCount])

  /** 書きかけの下書きがあれば確認してから進む。 */
  const guardDraft = (go: () => void) => {
    if (draft && draftHasContent(draft)) setDiscardThen(() => go)
    else go()
  }
  const selectEntry = (id: string) =>
    guardDraft(() => {
      setDraft(null)
      setSelectedId(id)
      setTab('form')
      setPeekId(null)
    })
  /** 「＋ 新しく登録」＝対話で開く（名前が先に決まっているときはそれを入れて）。 */
  const startDraft = (name = '') =>
    guardDraft(() => {
      setDraft(newDraft(name))
      setSelectedId(null)
      setTab('dialog')
      setPeekId(null)
    })

  /** プレビューの [[用語]] クリック：解決済み→チラ見、未解決→その名前で新規の下書きへ。 */
  const jumpToRef = (name: string) => {
    const hit = resolveRef(name, entries)
    if (hit) setPeekId(hit.id)
    else startDraft(name.trim())
  }

  /** 下書きを登録する（対話の「用語集に登録する」・フォームの「用語集に登録」）。 */
  const registerDraft = async (d: GlossaryEntry) => {
    if (d.name.trim() === '') throw new Error('名前を入れると登録できます')
    const id = await onCreate({
      name: d.name.trim(),
      aliases: d.aliases,
      category: d.category,
      reading: d.reading,
      // 公開情報は 1 欄（旧・詳細は結合して summary へ）
      summary: publicTextOf(d) || undefined,
      authorNote: d.authorNote,
      thumbnail: d.thumbnail,
      dialog: d.dialog,
      dialogVersion: d.dialogVersion,
    })
    setDraft(null)
    setSelectedId(id)
    setTab('form')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-surface">
      <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[1200px] flex-1 flex-col gap-3 px-5 pt-7 md:px-8">
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

        <div className="flex min-h-0 flex-1 items-stretch gap-6">
          {/* 左：検索・絞り込み・項目一覧。狭幅では選択中（下書き含む）は隠して編集面に譲る。 */}
          <nav
            aria-label="用語集の項目"
            className={cn(
              'w-full flex-col gap-2.5 pb-6 md:flex md:w-[17rem] md:shrink-0',
              current ? 'hidden' : 'flex',
            )}
          >
            {/* 「＋ 新しく登録」は対話で開く（D-DLG-ENTRY）。 */}
            <Button onClick={() => startDraft()} size="sm" className="w-full gap-1.5">
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
            {categories.length > 0 || inProgressCount > 0 ? (
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
                {inProgressCount > 0 ? (
                  <FilterChip
                    label={`対話の途中 ${inProgressCount}`}
                    active={category === DIALOG_FILTER}
                    onClick={() =>
                      setCategory((cur) => (cur === DIALOG_FILTER ? null : DIALOG_FILTER))
                    }
                  />
                ) : null}
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
                    dialog={dialogStates.get(entry.id) ?? EMPTY_SUMMARY}
                    active={entry.id === selectedId && draft === null}
                    used={getAppearances(entry).refCount > 0}
                    onClick={() => selectEntry(entry.id)}
                  />
                ))}
              </ul>
            )}
          </nav>

          {/* 右：選んだ項目（または新規の下書き）の編集面。狭幅では未選択のとき隠して一覧に譲る。 */}
          <section
            aria-label="項目の編集"
            className={cn(
              'min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-10 md:flex',
              current ? 'flex' : 'hidden',
            )}
          >
            {current ? (
              <EntryEditor
                key={current.id}
                entry={current}
                isDraft={draft !== null}
                tab={tab}
                onTabChange={setTab}
                dialog={currentDialog ?? EMPTY_SUMMARY}
                appearances={draft ? { episodeIds: [], refCount: 0 } : getAppearances(current)}
                entries={entries}
                resolvedNames={resolvedNames}
                onCommitValues={async (values) => {
                  // 下書きは保存済みの項目と同じ写像・同じ畳み方で手元の entry に当てる。
                  if (draft) {
                    setDraft((d) =>
                      d ? applyGlossaryFieldPatch(d, formValuesToFieldPatch(values), 0) : d,
                    )
                  } else await onUpdate(current.id, values)
                }}
                onCommitName={async (name) => {
                  if (draft) setDraft((d) => (d ? { ...d, name } : d))
                  else await onRename(current.id, name, { rewriteBody: false })
                }}
                onDialogChange={async (next, prev) => {
                  if (draft) {
                    setDraft(next)
                    return
                  }
                  const patch: GlossaryDialogPatch = {}
                  if (next.dialog !== prev.dialog) {
                    const diff = dialogRecordDiff(prev.dialog, next.dialog)
                    if (Object.keys(diff).length > 0) {
                      patch.dialogPatch = diff
                      patch.dialogVersion = DIALOG_VERSION
                    }
                  }
                  if ((next.category ?? '') !== (prev.category ?? '')) {
                    patch.category = next.category ?? ''
                  }
                  if (publicTextOf(next) !== publicTextOf(prev)) patch.summary = publicTextOf(next)
                  if (Object.keys(patch).length > 0) await onUpdateDialog(current.id, patch)
                }}
                onRegister={draft ? registerDraft : undefined}
                initialSession={
                  draft && restored.current?.entry.id === draft.id
                    ? restored.current.session
                    : undefined
                }
                onSessionChange={draft ? keepDraftSession : undefined}
                onRequestDelete={() => {
                  if (draft) guardDraft(() => setDraft(null))
                  else setDeleteTarget(current)
                }}
                onCreateEntry={onCreateEntry}
                onRefClick={jumpToRef}
                onBack={() => {
                  if (draft) guardDraft(() => setDraft(null))
                  else setSelectedId(null)
                }}
                assetRepo={gameAssetRepo}
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
        </div>
      </div>

      {/* プレビューの [[用語]] クリックで開くチラ見ドロワー。本文・プロットの用語集パネルと
          同じく、コンテンツ幅の内側ではなく**メイン領域の右端に全高**で出す。
          編集面はそのまま＝参照しながら書き続けられる。 */}
      {peeked ? (
        <aside
          aria-label="用語のチラ見"
          className="flex w-[min(300px,85vw)] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans"
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
                onEdit={() => selectEntry(peeked.id)}
              />
            </div>
          </div>
        </aside>
      ) : null}

      {/* 書きかけの下書きを捨てる確認 */}
      <ConfirmDialog
        open={discardThen !== null}
        onOpenChange={(o) => {
          if (!o) setDiscardThen(null)
        }}
        title="書きかけの項目を捨てますか？"
        description="まだ登録していない項目です。捨てると、対話で答えた内容は残りません。"
        confirmLabel="捨てる"
        onConfirm={() => {
          const go = discardThen
          setDiscardThen(null)
          setDraft(null)
          go?.()
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

/** 現在値から GlossaryFormValues を組む（1 フィールドずつ差し替えて確定する土台）。 */
function valuesOf(e: GlossaryEntry): GlossaryFormValues {
  return {
    name: e.name,
    aliases: e.aliases,
    category: e.category ?? '',
    reading: e.reading ?? '',
    // 公開情報は概要＋旧・詳細の結合＝一度でも保存すれば summary へ一本化される。
    summary: publicTextOf(e),
    authorNote: e.authorNote ?? '',
    thumbnail: e.thumbnail ?? '',
  }
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

/**
 * 左カラムの 1 行（サムネ or 頭文字・名前・分類と使用状況）。対話を始めた項目だけ進み具合を出す
 * （途中＝細いバーと n/m、済み＝✓・D-DLG-LIST）。手を付けていない項目は今までの見た目のまま。
 */
const EMPTY_SUMMARY: DialogSummary = {
  status: 'none',
  progress: { done: 0, total: 0, later: 0 },
}

function EntryRow({
  entry,
  dialog,
  active,
  used,
  onClick,
}: {
  entry: GlossaryEntry
  dialog: DialogSummary
  active: boolean
  used: boolean
  onClick: () => void
}) {
  const initial = entry.name.trim().charAt(0) || '？'
  const { status } = dialog
  const progress = status === 'inProgress' ? dialog.progress : null
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
          {progress ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-on-surface-variant">
              <span
                className="h-1 w-24 overflow-hidden rounded-full bg-surface-container-high"
                aria-hidden
              >
                <span
                  className="block h-full bg-primary"
                  style={{
                    width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                  }}
                />
              </span>
              対話 {progress.done}/{progress.total}
              {progress.later > 0 ? `・あとで ${progress.later}` : ''}
            </span>
          ) : status === 'done' ? (
            <span className="mt-0.5 text-[10.5px] text-primary">✓ 対話済み</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

/**
 * 右カラムの編集面。モーダルの「保存する」は無く、各フィールドが blur（欄を離れる）で
 * その場で確定する＝世界観設定と同じ書き味。名前・別名の衝突（D-GLOS-UNIQUE）は
 * reject をここで受けてエラー表示し、入力は保つ（打ち直せる）。
 * 見出し横の「フォーム｜対話」で二面を行き来する。対話は一度開いたら隠すだけ（会話の途中を保つ）。
 */
function EntryEditor({
  entry,
  isDraft,
  tab,
  onTabChange,
  dialog,
  appearances,
  entries,
  resolvedNames,
  onCommitValues,
  onCommitName,
  onDialogChange,
  onRegister,
  initialSession,
  onSessionChange,
  onRequestDelete,
  onCreateEntry,
  onRefClick,
  onBack,
  assetRepo,
}: {
  entry: GlossaryEntry
  isDraft: boolean
  tab: PaneTab
  onTabChange: (tab: PaneTab) => void
  /** 対話の状態と進み具合（親が項目ごとに 1 回だけ計算したもの）。 */
  dialog: DialogSummary
  appearances: Appearances
  entries: GlossaryEntry[]
  resolvedNames: Set<string>
  onCommitValues: (values: GlossaryFormValues) => Promise<void> | void
  onCommitName: (name: string) => Promise<void> | void
  /** 対話ペインが項目を進めたとき（答え・分類・公開の扱い・下書きの公開情報）。prev は直前の手元の項目。 */
  onDialogChange: (next: GlossaryEntry, prev: GlossaryEntry) => Promise<void> | void
  /** 下書きの登録（下書きのときだけ）。 */
  onRegister?: (entry: GlossaryEntry) => Promise<void>
  /** 画面を離れて戻った下書きの会話と、その保存先（下書きのときだけ）。 */
  initialSession?: DialogSession
  onSessionChange?: (session: DialogSession) => void
  onRequestDelete: () => void
  onCreateEntry?: (name: string) => Promise<string | null>
  onRefClick: (name: string) => void
  onBack: () => void
  assetRepo?: GameAssetRepository
}) {
  const uid = useId()
  const [error, setError] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [registering, setRegistering] = useState(false)
  // 対話は最初に開いたときに始める（それまでは台本も作らない）。以後はタブを切り替えても隠すだけ。
  const [dialogOpened, setDialogOpened] = useState(tab === 'dialog')
  useEffect(() => {
    if (tab === 'dialog') setDialogOpened(true)
  }, [tab])

  const commitField = async (patch: Partial<GlossaryFormValues>) => {
    setError(null)
    try {
      await onCommitValues({ ...valuesOf(entry), ...patch })
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const commitName = async (name: string) => {
    if (name === entry.name) return
    setError(null)
    try {
      await onCommitName(name)
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

  const register = async () => {
    if (!onRegister || registering) return
    setRegistering(true)
    setError(null)
    try {
      await onRegister(entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setRegistering(false)
    }
  }

  // 既存データに固定リスト外のカテゴリ（旧・自由入力）があれば選択肢に含めて保全する。
  const legacyCategory =
    (entry.category ?? '') !== '' &&
    !(GLOSSARY_CATEGORIES as readonly string[]).includes(entry.category ?? '')
      ? (entry.category as string)
      : null

  const used = appearances.refCount > 0
  const progress = dialog.progress

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

      {/* 名前＋フォーム｜対話＋削除。名前は blur で確定（旧名は自動で別名に残り、本文の参照は解決され続ける）。 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <NameInput
            value={entry.name}
            placeholder={isDraft ? '新しい項目（名前は対話でも決められます）' : undefined}
            allowEmpty={isDraft}
            onCommit={(v) => void commitName(v)}
          />
          <p className="mt-1 text-[11px] text-on-surface-variant/60">
            {isDraft
              ? '新しい項目です。対話でもフォームでも書けます。登録するまで保存されません。'
              : `名前を変えても、旧名は自動で別名に残り本文中の参照はそのまま解決されます ・ ${
                  used
                    ? `${appearances.episodeIds.length}話・${appearances.refCount}回 登場`
                    : '未使用'
                }`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <fieldset
            className="m-0 inline-flex overflow-hidden rounded-md border border-outline-variant/40 bg-surface-container-lowest p-0"
            aria-label="フォームと対話の切り替え"
          >
            <PaneTabButton active={tab === 'form'} onClick={() => onTabChange('form')}>
              フォーム
            </PaneTabButton>
            <PaneTabButton active={tab === 'dialog'} onClick={() => onTabChange('dialog')}>
              対話
              <span className="ml-1 text-[10.5px] opacity-80">
                {progress.total > 0 ? `${progress.done}/${progress.total}` : '–'}
              </span>
            </PaneTabButton>
          </fieldset>
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={isDraft ? '書きかけを捨てる' : `「${entry.name}」を削除`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-on-surface-variant/70 transition-colors hover:bg-error-container hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {isDraft ? '捨てる' : '削除'}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* 対話（一度開いたら隠すだけ＝会話の途中を保つ）。 */}
      {dialogOpened ? (
        <DialogPane
          entry={entry}
          isDraft={isDraft}
          entries={entries}
          resolvedNames={resolvedNames}
          onChange={onDialogChange}
          onFinish={onRegister}
          initialSession={initialSession}
          onSessionChange={onSessionChange}
          onToForm={() => onTabChange('form')}
          onCreateEntry={onCreateEntry}
          onRefClick={onRefClick}
          className={tab === 'dialog' ? undefined : 'hidden'}
        />
      ) : null}

      {tab === 'form' ? (
        <>
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
              onCommit={(v) => void commitField({ aliases: parseAliasInput(v) })}
              placeholder="世界樹、ワールドツリー"
            />
          </div>

          {/* 公開情報（読者に見える）。記法つき＝@ / [[ サジェストとプレビュー。 */}
          <section className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-[13px] text-on-surface">公開情報</h2>
              <VisibilityLabel isPublic label="読者に見えます" />
              <NotationHelpButton />
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
              コトノハ-grove-
              へ投稿すると読者にも見えます（その用語が出てくる話まで読んだ読者だけに開きます）。 @
              または [[
              で他の用語を呼び出せます。プレビューの緑の語はクリックで右にチラ見が開きます。
            </p>
          </section>

          {/* 作者メモ（非公開）。 */}
          <section className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-[13px] text-on-surface">作者メモ</h2>
              <VisibilityLabel isPublic={false} label="公開されません" />
              <NotationHelpButton />
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

          {/* 対話ノート（見るだけ・直すのは対話から）。 */}
          <DialogNoteSection
            entry={entry}
            summary={dialog}
            onOpenDialog={() => onTabChange('dialog')}
            resolvedNames={resolvedNames}
            onRefClick={onRefClick}
          />

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

          {/* 立ち絵（人物のみ・PC 限定＝作る作業なので D-GAME-PC。実体は素材層で Work には入らない）。 */}
          {!isDraft && assetRepo && PERSON_CATEGORY.test(entry.category ?? '') ? (
            <div className="max-lg:hidden">
              <SpriteSection
                key={entry.name}
                name={entry.name}
                aliases={entry.aliases}
                assetRepo={assetRepo}
              />
            </div>
          ) : null}

          {/* 下書きの登録。名前が無いと登録できない（@ 参照の解決キー）。 */}
          {isDraft ? (
            <div className="flex items-center justify-end gap-3">
              {entry.name.trim() === '' ? (
                <span className="text-[11.5px] text-on-surface-variant/70">
                  名前を入れると登録できます
                </span>
              ) : null}
              <Button
                type="button"
                onClick={() => void register()}
                disabled={entry.name.trim() === '' || registering || imageBusy}
              >
                用語集に登録
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** 「フォーム｜対話」の切替ボタン。 */
function PaneTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-[12.5px] transition-colors md:py-1',
        active ? 'bg-primary text-white' : 'text-on-surface hover:bg-surface-container-high',
      )}
    >
      {children}
    </button>
  )
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

/** 名前の入力（blur で確定・空は元へ戻す。下書きでは空のままにできる）。見出しの見た目のまま編集できる。 */
function NameInput({
  value,
  onCommit,
  placeholder,
  allowEmpty = false,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  allowEmpty?: boolean
}) {
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
        if (v === '' && !allowEmpty) setDraft(value)
        else if (v !== value) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="名前"
      placeholder={placeholder}
      className="w-full rounded-md bg-transparent px-1 font-semibold font-serif text-[20px] text-on-surface outline-none transition-colors hover:bg-surface-container-high focus:bg-surface-container-high"
    />
  )
}
