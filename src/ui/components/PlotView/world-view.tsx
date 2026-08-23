import { Lock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  type Plot,
  removeWorldNote,
  setWorldNote,
  WORLD_CUSTOM_SLOT,
  WORLD_SLOTS,
  type WorldNote,
  type WorldSlotDef,
  worldNoteLabel,
} from '@/core/plot'
import { Button } from '@/ui/components/ui/button'

/**
 * 世界観設定タブ（作者専用の設定置き場）。
 *
 * 用語集は公開サイトで読者にも開く器なので、設定のルールや執筆の決め事、まだ伏せている真相の
 * 行き場がなかった。ここはプロットと同じ器（Plot.world）に住むので公開バンドルには載らない＝
 * 安心して書ける。
 *
 * 作りは**案内文つきの決まった枠**。10 の枠を空でも常に並べ、それぞれに「ここに何を書くのか」を
 * 添える。書くことを思いつく順ではなく、枠を上から埋めれば整理が終わる形にしている
 * （自由記述 1 枚だと、何を書けばいいか分からないまま止まるか、際限なく伸びるかのどちらかになる）。
 */

const genId = () => crypto.randomUUID()

interface WorldViewProps {
  plot: Plot
  onApply: (fn: (p: Plot) => Plot) => void
}

const GROUP_LABEL = {
  world: '世界のこと',
  writing: '書き方のこと',
} as const

const GROUP_CAPTION = {
  world:
    'その世界が何で、どうなっているか。読者に説明する文ではなく、作者が迷わないための控えです。',
  writing:
    'その世界をどう書くか。人称や語彙、何を伏せるか——書きながらぶれる部分を先に決めておきます。',
} as const

export function WorldView({ plot, onApply }: WorldViewProps) {
  const notes = plot.world
  const byslot = (key: string) => notes.find((n) => n.slot === key)
  const customs = notes.filter((n) => !WORLD_SLOTS.some((s) => s.key === n.slot))
  const filled = WORLD_SLOTS.filter((s) => byslot(s.key) !== undefined).length

  /** 定型枠の書き込み。空文字は削除（コア側の規約）なので、消したいときもこの経路でよい。 */
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
    onApply((p) =>
      setWorldNote(
        p,
        { slot: WORLD_CUSTOM_SLOT, title: '新しいメモ', body: 'ここに書きます' },
        genId(),
        Date.now(),
      ),
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* 何のための場所かを最初に言い切る。「用語集と何が違うのか」で毎回迷わせない。 */}
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 font-medium text-[11px] text-on-secondary-container">
            <Lock className="size-2.5" aria-hidden />
            公開されません
          </span>
          <span className="text-[12px] text-on-surface-variant tabular-nums">
            {filled} / {WORLD_SLOTS.length} の枠に記入済み
          </span>
        </div>
        <p className="mt-2 text-[13px] text-on-surface-variant leading-relaxed">
          この作品の決め事を置く、作者だけの場所です。設定のルール・世界の仕組み・執筆の方針は
          ここへ書いてください。読者が読む人物や用語の説明は「用語集」へ
          （そちらは投稿すると読者にも見えます）。
        </p>
        <p className="mt-1.5 text-[12px] text-on-surface-variant/70 leading-relaxed">
          AI（MCP）は用語集やプロットを書き換える前にここを読みます。書いておくほど、頼んだときの
          精度が上がります。
        </p>
      </div>

      {(['world', 'writing'] as const).map((group) => (
        <section key={group} className="flex flex-col gap-2.5">
          <div>
            <h2 className="font-semibold font-serif text-[16px] text-on-surface">
              {GROUP_LABEL[group]}
            </h2>
            <p className="mt-0.5 text-[12px] text-on-surface-variant/80 leading-relaxed">
              {GROUP_CAPTION[group]}
            </p>
          </div>
          {WORLD_SLOTS.filter((s) => s.group === group).map((slot) => (
            <SlotCard
              key={slot.key}
              slot={slot}
              note={byslot(slot.key)}
              onCommit={(body) => commitSlot(slot, body)}
            />
          ))}
        </section>
      ))}

      <section className="flex flex-col gap-2.5">
        <div>
          <h2 className="font-semibold font-serif text-[16px] text-on-surface">そのほか</h2>
          <p className="mt-0.5 text-[12px] text-on-surface-variant/80 leading-relaxed">
            上の枠に収まらないものは、自分で見出しを付けて足せます。
          </p>
        </div>
        {customs.map((note) => (
          <CustomCard
            key={note.id}
            note={note}
            onCommit={(patch) => commitCustom(note, patch)}
            onDelete={() => onApply((p) => removeWorldNote(p, note.id))}
          />
        ))}
        <Button variant="outline" onClick={addCustom} className="w-fit gap-2">
          <Plus className="size-4" aria-hidden />
          メモを足す
        </Button>
      </section>
    </div>
  )
}

/**
 * 1 枠のカード。閉じているときは案内文と書いた内容、押すと textarea へ切り替わり blur で確定する。
 * 10 枠ぶんの textarea を常時開くと画面が読み物でなくなるので、読むときは文章、書くときだけ入力欄。
 */
function SlotCard({
  slot,
  note,
  onCommit,
}: {
  slot: WorldSlotDef
  note: WorldNote | undefined
  onCommit: (body: string) => void
}) {
  const body = note?.body ?? ''
  return (
    <NoteCard
      label={slot.label}
      guide={slot.guide}
      placeholder={slot.placeholder}
      body={body}
      onCommit={onCommit}
    />
  )
}

/** 自由枠のカード。見出しも編集でき、削除できる（定型枠は消えないので削除は自由枠だけ）。 */
function CustomCard({
  note,
  onCommit,
  onDelete,
}: {
  note: WorldNote
  onCommit: (patch: { title?: string; body?: string }) => void
  onDelete: () => void
}) {
  return (
    <NoteCard
      label={worldNoteLabel(note)}
      guide=""
      placeholder="ここに書きます"
      body={note.body}
      onCommit={(body) => onCommit({ body })}
      onRenameLabel={(title) => onCommit({ title })}
      onDelete={onDelete}
    />
  )
}

interface NoteCardProps {
  label: string
  guide: string
  placeholder: string
  body: string
  onCommit: (body: string) => void
  /** 自由枠だけ渡す（見出しを編集できる）。 */
  onRenameLabel?: (title: string) => void
  /** 自由枠だけ渡す（定型枠は空にすることはできても消せない）。 */
  onDelete?: () => void
}

function NoteCard({
  label,
  guide,
  placeholder,
  body,
  onCommit,
  onRenameLabel,
  onDelete,
}: NoteCardProps) {
  const uid = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // 同期の pull などで確定値が変わったら、編集していないカードは追随させる。
  useEffect(() => {
    if (!editing) setDraft(body)
  }, [body, editing])

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== body.trim()) onCommit(draft)
  }

  return (
    <article className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onRenameLabel ? (
            <LabelInput value={label} onCommit={onRenameLabel} />
          ) : (
            <h3 className="font-medium text-[14px] text-on-surface" id={`${uid}-label`}>
              {label}
            </h3>
          )}
          {guide ? (
            <p className="mt-1 text-[12px] text-on-surface-variant/80 leading-relaxed">{guide}</p>
          ) : null}
        </div>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${label}を削除`}
            className="shrink-0 rounded-md p-1.5 text-on-surface-variant/60 transition-colors hover:bg-error-container hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="mt-2.5">
        {editing ? (
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Esc は書きかけを捨てて閉じる（本文の長文入力なので Enter は改行のまま）。
              if (e.key === 'Escape') {
                setDraft(body)
                setEditing(false)
              }
            }}
            aria-label={label}
            placeholder={placeholder}
            rows={Math.min(20, Math.max(5, draft.split('\n').length + 1))}
            className="w-full resize-y rounded-md border border-primary/50 bg-surface px-3 py-2 text-[13.5px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-container-high"
          >
            {body ? (
              <span className="block whitespace-pre-wrap text-[13.5px] text-on-surface leading-relaxed">
                {body}
              </span>
            ) : (
              <span className="block text-[13px] text-on-surface-variant/50">{placeholder}</span>
            )}
          </button>
        )}
      </div>
    </article>
  )
}

/** 自由枠の見出し入力（blur で確定・Esc で戻す。PremiseInput と同じ流儀）。 */
function LabelInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
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
        // 見出しを空にはできない（自由枠は見出しが本体）。空なら元に戻す。
        if (draft.trim() === '') setDraft(value)
        else if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="メモの見出し"
      className="w-full rounded-md bg-transparent font-medium text-[14px] text-on-surface outline-none transition-colors hover:bg-surface-container-high focus:bg-surface-container-high"
    />
  )
}
