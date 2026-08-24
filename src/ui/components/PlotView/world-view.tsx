import { Check, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  type Plot,
  removeWorldNote,
  setWorldNote,
  WORLD_CUSTOM_SLOT,
  WORLD_SLOTS,
  type WorldNote,
  type WorldSlotDef,
  type WorldSlotGroup,
  worldNoteLabel,
} from '@/core/plot'
import type { GlossaryEntry } from '@/core/schema'
import { CommitTextarea } from '@/ui/components/NotationField/commit-textarea'

/**
 * 世界観設定タブ（作者専用の設定置き場）。
 *
 * 用語集は公開サイトで読者にも開く器なので、設定のルールや執筆の決め事、まだ伏せている真相の
 * 行き場がなかった。ここはプロットと同じ器（Plot.world）に住むので公開バンドルには載らない＝
 * 安心して書ける。
 *
 * 画面はビートシートと同じ**左：項目の一覧／右：編集**の二枚看板にしてある。
 * 枠を縦に積む作りだと、案内文つきの入力欄が 11 個ぶん連なって、書くたびにスクロールで
 * 迷子になる（アコーディオンで畳んでも「開いた節の中で縦に長い」は消えなかった）。
 * 左は項目名と記入済みの印だけなので細くてよく、そのぶん右の入力欄に幅と**画面いっぱいの高さ**を
 * 渡せる。項目の切り替えはクリック 1 回で、ページは縦に動かない。
 */

const genId = () => crypto.randomUUID()

interface WorldViewProps {
  plot: Plot
  onApply: (fn: (p: Plot) => Plot) => void
  /** 用語集（@ / [[ のサジェスト候補）。 */
  glossary: GlossaryEntry[]
  /** 候補に無い語をその場で用語集へ登録する（作成した名前を返す。失敗は null）。 */
  onCreateGlossaryEntry?: (name: string) => Promise<string | null>
}

const GROUPS: { key: WorldSlotGroup; label: string }[] = [
  { key: 'world', label: '世界と舞台' },
  { key: 'writing', label: '書き方の決め事' },
  { key: 'reader', label: '読者への見せ方' },
]

export function WorldView({ plot, onApply, glossary, onCreateGlossaryEntry }: WorldViewProps) {
  // 読み込み時に normalizePlot が埋めるが、この画面は欠落しても落ちない側に倒しておく
  // （落ちると画面だけでなくアプリのツリーごと消えるため）。
  const notes = plot.world ?? []
  const bySlot = useCallback(
    (key: string) => notes.find((n) => n.slot === key),
    // notes は毎描画で作り直されるが、比較したいのは中身なので plot.world を見る
    [notes],
  )
  const customs = useMemo(
    () => notes.filter((n) => !WORLD_SLOTS.some((s) => s.key === n.slot)),
    [notes],
  )
  const filled = WORLD_SLOTS.filter((s) => bySlot(s.key) !== undefined).length

  // 選択中の項目。定型枠は slot の key、自由枠はノートの id をそのまま入れる
  // （slot の key と uuid は衝突しないので 1 つの文字列で足りる）。
  const [selectedId, setSelectedId] = useState<string>(WORLD_SLOTS[0]?.key ?? '')
  const selectedSlot = WORLD_SLOTS.find((s) => s.key === selectedId)
  const selectedCustom = customs.find((n) => n.id === selectedId)

  // 足した直後のメモの id。保存は非同期なので、plot に現れるまでの一瞬は
  // 「選択中の項目が無い」状態になる。そこで戻してしまうと、足したメモではなく
  // 先頭の枠が開いてしまうため、この間だけ戻さない。
  const pendingId = useRef<string | null>(null)

  // 選択していた自由枠が消えたら（削除・同期）先頭の枠へ戻す＝右が空白のままにならない。
  useEffect(() => {
    if (selectedSlot || selectedCustom) {
      pendingId.current = null
      return
    }
    if (pendingId.current === selectedId) return
    setSelectedId(WORLD_SLOTS[0]?.key ?? '')
  }, [selectedSlot, selectedCustom, selectedId])

  const commitSlot = (slot: WorldSlotDef, body: string) => {
    onApply((p) => setWorldNote(p, { slot: slot.key, body }, genId(), Date.now()))
  }

  const commitCustom = (note: WorldNote, patch: { title?: string; body?: string }) => {
    onApply((p) =>
      setWorldNote(
        p,
        {
          id: note.id,
          slot: WORLD_CUSTOM_SLOT,
          title: patch.title ?? note.title,
          body: patch.body ?? note.body,
        },
        genId(),
        Date.now(),
      ),
    )
  }

  const addCustom = () => {
    const id = genId()
    pendingId.current = id
    onApply((p) =>
      setWorldNote(p, { slot: WORLD_CUSTOM_SLOT, title: '新しいメモ', body: '' }, id, Date.now()),
    )
    setSelectedId(id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 器の説明は 1 行に畳む。入力欄の高さを稼ぐのがこの画面の主目的なので、
          毎回読む必要のない案内で上を占領しない（詳しい話は左カラムの下に置く）。 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-medium text-[11px] text-on-secondary-container">
          <Lock className="size-2.5" aria-hidden />
          公開されません
        </span>
        <span className="tabular-nums">
          {filled} / {WORLD_SLOTS.length} の枠に記入済み
        </span>
        <span className="text-on-surface-variant/70">
          作者だけの場所です。読者に見せる人物や用語の説明は「用語集」へ。
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-5">
        {/* 左：項目の一覧。1 項目 1 行なので、11 枠あっても畳まずに全部見える。 */}
        <nav
          aria-label="世界観設定の項目"
          className="flex w-[13.5rem] shrink-0 flex-col overflow-y-auto pb-6"
        >
          {GROUPS.map((group) => (
            <div key={group.key} className="mb-3">
              <h2 className="px-2 pb-1 font-medium text-[11px] text-on-surface-variant/70">
                {group.label}
              </h2>
              {WORLD_SLOTS.filter((s) => s.group === group.key).map((slot) => (
                <ItemButton
                  key={slot.key}
                  label={slot.label}
                  optional={slot.optional}
                  done={bySlot(slot.key) !== undefined}
                  active={selectedId === slot.key}
                  onClick={() => setSelectedId(slot.key)}
                />
              ))}
            </div>
          ))}

          <div className="mb-3">
            <h2 className="px-2 pb-1 font-medium text-[11px] text-on-surface-variant/70">
              そのほか
            </h2>
            {customs.map((note) => (
              <ItemButton
                key={note.id}
                label={worldNoteLabel(note)}
                done
                active={selectedId === note.id}
                onClick={() => setSelectedId(note.id)}
              />
            ))}
            <button
              type="button"
              onClick={addCustom}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
            >
              <Plus className="size-3.5 shrink-0" aria-hidden />
              メモを足す
            </button>
          </div>

          {/* 幅が細いので、毎回読ませたい要点だけを 2 文で置く。 */}
          <p className="mt-auto px-2 pt-4 text-[11px] text-on-surface-variant/60 leading-relaxed">
            全部埋める必要はありません。
            <br />
            AI（MCP）は書き換える前にここを読みます。
          </p>
        </nav>

        {/* 右：選択中の項目だけを、幅も高さも使って書く。 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedSlot ? (
            <NoteEditor
              key={selectedSlot.key}
              label={selectedSlot.label}
              guide={selectedSlot.guide}
              placeholder={selectedSlot.placeholder}
              optional={selectedSlot.optional}
              body={bySlot(selectedSlot.key)?.body ?? ''}
              onCommit={(body) => commitSlot(selectedSlot, body)}
              glossary={glossary}
              onCreateGlossaryEntry={onCreateGlossaryEntry}
            />
          ) : selectedCustom ? (
            <NoteEditor
              key={selectedCustom.id}
              label={worldNoteLabel(selectedCustom)}
              guide=""
              placeholder="ここに書きます"
              body={selectedCustom.body}
              onCommit={(body) => commitCustom(selectedCustom, { body })}
              onRenameLabel={(title) => commitCustom(selectedCustom, { title })}
              onDelete={() => onApply((p) => removeWorldNote(p, selectedCustom.id))}
              glossary={glossary}
              onCreateGlossaryEntry={onCreateGlossaryEntry}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 左カラムの 1 行。記入済みかどうかがひと目で分かるようにする。 */
function ItemButton({
  label,
  done,
  active,
  optional,
  onClick,
}: {
  label: string
  done: boolean
  active: boolean
  optional?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${
        active
          ? 'bg-secondary-container font-medium text-on-secondary-container'
          : 'text-on-surface hover:bg-surface-container-high'
      }`}
    >
      {done ? (
        <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* 印は色と形だけでは伝わらないので、読み上げ用の語を項目名のうしろに足す。 */}
      {done ? <span className="sr-only">記入済み</span> : null}
      {optional && !done ? (
        <span className="shrink-0 text-[10px] text-on-surface-variant/60">任意</span>
      ) : null}
    </button>
  )
}

interface NoteEditorProps {
  label: string
  guide: string
  placeholder: string
  body: string
  optional?: boolean
  onCommit: (body: string) => void
  /** 自由枠だけ渡す（見出しを編集できる）。 */
  onRenameLabel?: (title: string) => void
  /** 自由枠だけ渡す（定型枠は空にできても消せない）。 */
  onDelete?: () => void
  glossary: GlossaryEntry[]
  onCreateGlossaryEntry?: (name: string) => Promise<string | null>
}

/**
 * 右カラムの編集面。見出しと案内文は上に固定し、入力欄が残りの高さを全部取る。
 * 項目を切り替えると key が変わって作り直される＝下の「外れるときに送る」が確定処理になる。
 */
function NoteEditor({
  label,
  guide,
  placeholder,
  body,
  optional,
  onCommit,
  onRenameLabel,
  onDelete,
  glossary,
  onCreateGlossaryEntry,
}: NoteEditorProps) {
  const uid = useId()
  return (
    <>
      <div className="mb-2 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {onRenameLabel ? (
              <LabelInput value={label} onCommit={onRenameLabel} />
            ) : (
              <label
                htmlFor={`${uid}-body`}
                className="font-semibold font-serif text-[17px] text-on-surface"
              >
                {label}
              </label>
            )}
            {optional ? (
              <span className="shrink-0 rounded-full bg-surface-container-high px-1.5 py-0.5 font-medium text-[10px] text-on-surface-variant/80">
                任意
              </span>
            ) : null}
          </div>
          {guide ? (
            <p className="mt-1 text-[12.5px] text-on-surface-variant/80 leading-relaxed">{guide}</p>
          ) : null}
        </div>
        {/* 自由枠だけの操作。アイコンだけだと気づかれないので、文字も添える。 */}
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${label}を削除`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-on-surface-variant/70 transition-colors hover:bg-error-container hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            削除
          </button>
        ) : null}
      </div>
      {/* 本文・プロットと同じ記法が使える：@／＠／[[ で用語集を呼び出し、無い語はその場で作れる。 */}
      <CommitTextarea
        id={`${uid}-body`}
        ariaLabel={label}
        value={body}
        onCommit={onCommit}
        placeholder={placeholder}
        glossary={glossary}
        onCreateEntry={onCreateGlossaryEntry}
        grow={false}
        wrapperClassName="flex min-h-0 flex-1 flex-col"
        className="min-h-0 flex-1 px-3 py-2 text-[14px]"
      />
      <p className="mt-1.5 shrink-0 text-[11px] text-on-surface-variant/60">
        @ または [[ で用語集を呼び出せます（無い語はその場で登録できます）。
      </p>
    </>
  )
}

/** 自由枠の見出し入力（blur で確定・Esc で戻す。PremiseInput と同じ流儀）。 */
function LabelInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          // 見出しを空にはできない（自由枠は見出しが本体）。空なら元へ戻す。
          if (draft.trim() === '') setDraft(value)
          else if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(value)
        }}
        aria-label="メモの見出し"
        // field-sizing:content で中身ぶんの幅に収める＝すぐ隣に鉛筆のボタンを置ける
        //（flex-1 で伸ばすとボタンが右端まで飛び、見出しと結びついて見えない）。
        className="min-w-[6rem] max-w-full rounded-md bg-transparent px-1 font-semibold font-serif text-[17px] text-on-surface outline-none transition-colors [field-sizing:content] hover:bg-surface-container-high focus:bg-surface-container-high"
      />
      {/* 押して編集に入れる。飾りの印だと「押しても何も起きない」ので、必ず操作を持たせる。
          既存の見出しは丸ごと選択しておく＝「新しいメモ」を打ち直すのが 1 手で済む。 */}
      <button
        type="button"
        aria-label="見出しを変える"
        title="見出しを変える"
        onClick={() => {
          ref.current?.focus()
          ref.current?.select()
        }}
        className="shrink-0 rounded-md p-1 text-on-surface-variant/50 transition-colors hover:bg-surface-container-high hover:text-primary"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </span>
  )
}
