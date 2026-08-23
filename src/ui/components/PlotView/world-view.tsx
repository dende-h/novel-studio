import { Lock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/ui/components/ui/accordion'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

/**
 * 世界観設定タブ（作者専用の設定置き場）。
 *
 * 用語集は公開サイトで読者にも開く器なので、設定のルールや執筆の決め事、まだ伏せている真相の
 * 行き場がなかった。ここはプロットと同じ器（Plot.world）に住むので公開バンドルには載らない＝
 * 安心して書ける。
 *
 * 作りは**案内文つきの決まった枠**。空でも枠を並べ、それぞれに「ここに何を書くのか」を添える
 * （自由記述 1 枚だと、何を書けばいいか分からないまま止まるか、際限なく伸びるかのどちらかになる）。
 *
 * 枠数が多いので、まとまりごとにアコーディオンで畳む（progressive disclosure）。畳んだ中身は
 * 忘れられるのが定石の弱点なので、見出しに「N / M 記入済み」を出して、開かなくても
 * どこに何があるか分かるようにしてある。
 */

const genId = () => crypto.randomUUID()

interface WorldViewProps {
  plot: Plot
  onApply: (fn: (p: Plot) => Plot) => void
}

const GROUPS: { key: WorldSlotGroup; label: string; caption: string }[] = [
  {
    key: 'world',
    label: '世界と舞台',
    caption: 'この物語が立っている場所。読者へ説明する文ではなく、作者が迷わないための控えです。',
  },
  {
    key: 'writing',
    label: '書き方の決め事',
    caption: '語り口・言葉・組み立て。書きながらぶれる部分を、先に決めておきます。',
  },
  {
    key: 'reader',
    label: '読者への見せ方',
    caption: '何を、いつ、どう出すか。そして書かないと決めたこと。',
  },
]

/** アコーディオンの value（グループ key と自由枠セクション）。 */
const CUSTOM_SECTION = 'custom'

export function WorldView({ plot, onApply }: WorldViewProps) {
  // 読み込み時に normalizePlot が埋めるが、この画面は欠落しても落ちない側に倒しておく
  // （落ちると画面だけでなくアプリのツリーごと消えるため）。
  const notes = plot.world ?? []
  const bySlot = (key: string) => notes.find((n) => n.slot === key)
  const customs = notes.filter((n) => !WORLD_SLOTS.some((s) => s.key === n.slot))
  const filled = WORLD_SLOTS.filter((s) => bySlot(s.key) !== undefined).length

  // 既定は最初のまとまりだけ開く。畳んだ中身は見出しの件数で見えているので、
  // 全部開いた状態を初期値にして長大な画面から始めることはしない。
  const [open, setOpen] = useState<string[]>([GROUPS[0]?.key ?? 'world'])
  const allValues = [...GROUPS.map((g) => g.key), CUSTOM_SECTION]
  const allOpen = allValues.every((v) => open.includes(v))

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
    setOpen((cur) => (cur.includes(CUSTOM_SECTION) ? cur : [...cur, CUSTOM_SECTION]))
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
    <div className="flex flex-col gap-4 pb-16">
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
          全部埋める必要はありません。作品に関係のない枠は空のままで大丈夫です。AI（MCP）は
          用語集やプロットを書き換える前にここを読むので、書いておくほど頼んだときの精度が上がります。
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(allOpen ? [] : allValues)}
          className="rounded-md px-2 py-1 text-[12px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
        >
          {allOpen ? 'すべて閉じる' : 'すべて開く'}
        </button>
      </div>

      <Accordion
        type="multiple"
        value={open}
        onValueChange={setOpen}
        className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4"
      >
        {GROUPS.map((group) => {
          const slots = WORLD_SLOTS.filter((s) => s.group === group.key)
          const done = slots.filter((s) => bySlot(s.key) !== undefined).length
          return (
            <AccordionItem key={group.key} value={group.key}>
              <AccordionTrigger>
                <SectionHeading
                  label={group.label}
                  caption={group.caption}
                  badge={`${done} / ${slots.length}`}
                  filled={done > 0}
                />
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-5">
                {slots.map((slot) => (
                  <SlotField
                    key={slot.key}
                    slot={slot}
                    body={bySlot(slot.key)?.body ?? ''}
                    onCommit={(body) => commitSlot(slot, body)}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
          )
        })}

        <AccordionItem value={CUSTOM_SECTION}>
          <AccordionTrigger>
            <SectionHeading
              label="そのほか"
              caption="上の枠に収まらないものは、自分で見出しを付けて足せます。"
              badge={customs.length > 0 ? `${customs.length}件` : '—'}
              filled={customs.length > 0}
            />
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5">
            {customs.map((note) => (
              <CustomField
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

/**
 * アコーディオンの見出し。畳んだままでも「どこに何があるか」が読めるように、
 * まとまりの説明と記入済みの件数を必ず出す（畳んだ中身が忘れられるのを防ぐ）。
 */
function SectionHeading({
  label,
  caption,
  badge,
  filled,
}: {
  label: string
  caption: string
  badge: string
  filled: boolean
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="font-semibold font-serif text-[15px] text-on-surface">{label}</span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10.5px] tabular-nums ${
            filled
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-high text-on-surface-variant/70'
          }`}
        >
          {badge}
        </span>
      </span>
      <span className="text-[12px] text-on-surface-variant/80 leading-relaxed">{caption}</span>
    </span>
  )
}

/** 定型枠 1 つ。ラベル＋案内文＋入力欄の、ごく普通のフォーム行。 */
function SlotField({
  slot,
  body,
  onCommit,
}: {
  slot: WorldSlotDef
  body: string
  onCommit: (body: string) => void
}) {
  return (
    <NoteField
      label={slot.label}
      guide={slot.guide}
      placeholder={slot.placeholder}
      optional={slot.optional}
      body={body}
      onCommit={onCommit}
    />
  )
}

/** 自由枠。見出しも編集でき、削除できる（定型枠は空にできても消せない）。 */
function CustomField({
  note,
  onCommit,
  onDelete,
}: {
  note: WorldNote
  onCommit: (patch: { title?: string; body?: string }) => void
  onDelete: () => void
}) {
  return (
    <NoteField
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

interface NoteFieldProps {
  label: string
  guide: string
  placeholder: string
  body: string
  optional?: boolean
  onCommit: (body: string) => void
  /** 自由枠だけ渡す（見出しを編集できる）。 */
  onRenameLabel?: (title: string) => void
  /** 自由枠だけ渡す。 */
  onDelete?: () => void
}

function NoteField({
  label,
  guide,
  placeholder,
  body,
  optional,
  onCommit,
  onRenameLabel,
  onDelete,
}: NoteFieldProps) {
  const uid = useId()
  const [draft, setDraft] = useState(body)
  const focused = useRef(false)

  // 同期の pull などで確定値が変わったら追随させる（入力中のフィールドは巻き戻さない）。
  useEffect(() => {
    if (!focused.current) setDraft(body)
  }, [body])

  // 最後に送った内容。保存は非同期なので body の更新を待たずに二重送信しないための控え。
  const sent = useRef(body)
  useEffect(() => {
    if (!focused.current) sent.current = body
  }, [body])

  const commit = useCallback(
    (next: string) => {
      if (next.trim() === sent.current.trim()) return
      sent.current = next
      onCommit(next)
    },
    [onCommit],
  )

  // アコーディオンを閉じる・タブを離れるなどで欄が外れるとき、書きかけを取りこぼさない。
  // blur が先に走る経路がほとんどだが、そこに頼り切ると「閉じたら消えた」が起きうる。
  const latest = useRef({ draft, commit })
  latest.current = { draft, commit }
  useEffect(() => {
    return () => {
      latest.current.commit(latest.current.draft)
    }
  }, [])

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {onRenameLabel ? (
            <LabelInput value={label} onCommit={onRenameLabel} />
          ) : (
            // 「任意」の印はラベルの外に置く＝入力欄の名前は枠の名前だけで濁らせない。
            <div className="flex items-center gap-2">
              <Label htmlFor={`${uid}-body`} className="text-[13.5px]">
                {label}
              </Label>
              {optional ? (
                <span className="rounded-full bg-surface-container-high px-1.5 py-0.5 font-medium text-[10px] text-on-surface-variant/80">
                  任意
                </span>
              ) : null}
            </div>
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
      {/*
        入力欄は共有 Textarea（field-sizing-content）。中身に合わせて伸びるが max-h で頭打ちになり、
        そこから先は欄の中でスクロールする＝長文でページが無限に伸びず、書いた文字も隠れない。
        scrollbar-gutter:stable はスクロールバーが出た瞬間に文字が横へ跳ねるのを防ぐ。
      */}
      <Textarea
        id={`${uid}-body`}
        aria-label={onRenameLabel ? label : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          commit(draft)
        }}
        onKeyDown={(e) => {
          // 長文なので Enter は改行のまま。Esc だけ書きかけを捨てる逃げ道にする。
          if (e.key === 'Escape') {
            setDraft(body)
            sent.current = body
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        rows={3}
        className="max-h-[32vh] min-h-[4.5rem] [scrollbar-gutter:stable] text-[13.5px] leading-relaxed"
      />
    </div>
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
        // 見出しを空にはできない（自由枠は見出しが本体）。空なら元へ戻す。
        if (draft.trim() === '') setDraft(value)
        else if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="メモの見出し"
      className="w-full rounded-md bg-transparent font-medium text-[13.5px] text-on-surface outline-none transition-colors hover:bg-surface-container-high focus:bg-surface-container-high"
    />
  )
}
