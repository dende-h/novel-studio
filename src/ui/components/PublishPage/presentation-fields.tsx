import { useId } from 'react'
import {
  BINDING_LABELS,
  CATCHCOPY_MAX,
  MOTIF_LABELS,
  OBI_TEXT_MAX,
  type WorkPresentation,
} from '@/core/schema/work-presentation'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'

type Mood = NonNullable<WorkPresentation['mood']>

const moodDirections: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

function axis(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function MoodPad({
  mood,
  onChange,
}: {
  mood: WorkPresentation['mood']
  onChange: (mood: Mood | null) => void
}) {
  const instructionsId = useId()
  const valueId = useId()
  return (
    <div className="min-w-0 space-y-2">
      <p className="font-medium text-sm">気分</p>
      <p id={instructionsId} className="text-on-surface-variant text-xs">
        「読みたい空気感で探す」に使われます。同じ点をもう一度押すと解除できます。
        キーボードでは矢印キーで移動し、Enter または Space で中央を選択・解除できます。
      </p>
      <div className="max-w-sm space-y-1 text-center text-on-surface-variant text-xs">
        <div>テンポよく進む（会話多め）</div>
        <button
          type="button"
          aria-label="気分を選ぶ"
          aria-describedby={`${instructionsId} ${valueId}`}
          className="relative block h-36 w-full touch-manipulation cursor-crosshair overflow-hidden rounded-md border border-outline-variant focus-visible:outline-2 focus-visible:outline-primary"
          onClick={(event) => {
            if (event.detail === 0) {
              onChange(mood ? null : { tone: 50, pace: 50 })
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return
            const tone = axis(((event.clientX - rect.left) / rect.width) * 100)
            const pace = axis((1 - (event.clientY - rect.top) / rect.height) * 100)
            onChange(mood?.tone === tone && mood.pace === pace ? null : { tone, pace })
          }}
          onKeyDown={(event) => {
            const direction = moodDirections[event.key]
            if (!direction) return
            event.preventDefault()
            const current = mood ?? { tone: 50, pace: 50 }
            const step = event.shiftKey ? 10 : 1
            onChange({
              tone: axis(current.tone + direction[0] * step),
              pace: axis(current.pace + direction[1] * step),
            })
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-outline-variant"
          >
            <span className="bg-surface-container-low" />
            <span className="bg-primary/15" />
            <span className="bg-surface-container" />
            <span className="bg-primary/10" />
          </span>
          {mood && (
            <span
              aria-hidden
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-container-lowest bg-primary"
              style={{
                left: `clamp(8px, ${mood.tone}%, 100% - 8px)`,
                top: `clamp(8px, ${100 - mood.pace}%, 100% - 8px)`,
              }}
            />
          )}
        </button>
        <div className="flex justify-between gap-2">
          <span className="text-left">しっとり・落ち着いた</span>
          <span className="text-right">明るい・あたたかい</span>
        </div>
        <div>じっくり読む（描写豊か）</div>
      </div>
      <p id={valueId} aria-live="polite" className="text-on-surface-variant text-xs tabular-nums">
        {mood
          ? `明るさ ${mood.tone} / テンポ ${mood.pace}（各0〜100）`
          : mood === null
            ? '公開先の気分を解除'
            : '公開先の気分を維持'}
      </p>
      {mood && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
          気分を解除
        </Button>
      )}
    </div>
  )
}

function PresentationText({
  label,
  max,
  value,
  onChange,
}: {
  label: string
  max: number
  value: string | null | undefined
  onChange: (value: string | null) => void
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span id={`${id}-remaining`} className="text-on-surface-variant text-xs tabular-nums">
          残り{max - [...(value ?? '')].length}字
        </span>
      </div>
      <Input
        id={id}
        value={value ?? ''}
        aria-describedby={`${id}-remaining`}
        placeholder={value === null ? '公開先の文言を解除' : undefined}
        onChange={(event) => onChange([...event.target.value].slice(0, max).join('') || null)}
      />
    </div>
  )
}

function PresentationSelect<T extends string>({
  label,
  labels,
  value,
  onChange,
}: {
  label: string
  labels: Record<T, string>
  value: T | null | undefined
  onChange: (value: T | null | undefined) => void
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="block w-full rounded-md border border-outline-variant bg-surface-container-lowest p-2 text-on-surface text-sm"
        value={value === null ? 'auto' : (value ?? '')}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === 'auto' ? null : (next as T) || undefined)
        }}
      >
        <option value="">公開先の設定を維持</option>
        <option value="auto">自動選択に戻す</option>
        {Object.entries<string>(labels).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PresentationFields({
  value,
  onChange,
  disabled,
}: {
  value: WorkPresentation
  onChange: (value: WorkPresentation) => void
  disabled: boolean
}) {
  const titleId = useId()
  const obiId = useId()
  const hasSettings = Object.values(value).some((field) => field !== undefined)
  return (
    <fieldset
      aria-labelledby={titleId}
      disabled={disabled}
      className="min-w-0 space-y-4 border-outline-variant/40 border-t pt-4"
    >
      <div className="space-y-1">
        <h3 id={titleId} className="font-semibold font-serif text-on-surface">
          作品の見た目（任意）
        </h3>
        <p className="text-on-surface-variant text-xs leading-relaxed">
          leafで指定した項目は、投稿するたびにgroveの書斎の設定を上書きします。
        </p>
      </div>
      <MoodPad mood={value.mood} onChange={(mood) => onChange({ ...value, mood })} />
      <PresentationText
        label="キャッチコピー"
        max={CATCHCOPY_MAX}
        value={value.catchcopy}
        onChange={(catchcopy) => onChange({ ...value, catchcopy })}
      />
      <details className="rounded-md border border-outline-variant/40 p-3">
        <summary className="cursor-pointer text-on-surface text-sm">
          装丁・モチーフ・帯（任意）
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PresentationSelect
              label="装丁"
              labels={BINDING_LABELS}
              value={value.binding}
              onChange={(binding) => onChange({ ...value, binding })}
            />
            <PresentationSelect
              label="モチーフ"
              labels={MOTIF_LABELS}
              value={value.motif}
              onChange={(motif) => onChange({ ...value, motif })}
            />
          </div>
          <PresentationText
            label="帯の文言"
            max={OBI_TEXT_MAX}
            value={value.obiText}
            onChange={(obiText) => onChange({ ...value, obiText })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              id={obiId}
              checked={value.showObi === true}
              onCheckedChange={(showObi) => onChange({ ...value, showObi })}
            />
            <Label htmlFor={obiId}>帯を出す</Label>
            <span className="text-on-surface-variant text-xs">
              {value.showObi === undefined
                ? '公開先の設定を維持'
                : value.showObi
                  ? '表示する'
                  : '表示しない'}
            </span>
          </div>
        </div>
      </details>
      {hasSettings && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({})}
          className="h-auto max-w-full whitespace-normal text-left"
        >
          見た目の送信設定をすべて外す
        </Button>
      )}
    </fieldset>
  )
}
