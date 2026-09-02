import { Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { seDuration } from '@/core/game/sePresets'
import {
  type CatalogBackground,
  type CatalogSe,
  type CatalogSprite,
  categoriesOf,
  categoryLabelOf,
  type TemplateKind,
  type TemplateManifest,
  visibleTemplates,
} from '@/core/game/templates'
import { cn } from '@/lib/utils'
import { playCatalogSe } from '@/ui/_utils/sePlayer'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { templateBgSrc, templateSpriteSrc } from '@/ui/game/template-catalog'

/**
 * 運営テンプレ（背景・立ち絵）を分類で絞ってサムネイルから選ぶダイアログ。
 * 演出エディタの背景・立ち絵、書き出しの既定背景、図鑑の立ち絵欄で共用する。
 * 一覧は目録の「一覧に出す」ものだけ（非表示は出さない・既存の参照は別途描ける）。
 */

type Item = CatalogBackground | CatalogSprite | CatalogSe

/** 効果音の長さ（秒）。目録の音は測った値、合成はレシピから。 */
function seSeconds(se: CatalogSe): string | null {
  const ms = se.durationMs ?? (se.builtin ? seDuration(se.builtin) * 1000 : undefined)
  return ms === undefined ? null : `${(ms / 1000).toFixed(1)} 秒`
}

interface TemplatePickerProps<T extends Item> {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: TemplateKind
  items: readonly T[]
  manifest: TemplateManifest | null
  /** いま選ばれているキー（枠を付ける） */
  selectedKey?: string
  onPick: (item: T) => void
  title?: string
  description?: string
}

const ALL = '__all__'

export function TemplatePicker<T extends Item>({
  open,
  onOpenChange,
  kind,
  items,
  manifest,
  selectedKey,
  onPick,
  title,
  description,
}: TemplatePickerProps<T>) {
  const [category, setCategory] = useState<string>(ALL)
  const visible = useMemo(() => visibleTemplates(items), [items])
  const categories = useMemo(() => categoriesOf(visible), [visible])
  const shown = category === ALL ? visible : visible.filter((i) => i.category === category)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-on-surface">
            {title ??
              (kind === 'bg'
                ? 'テンプレの背景'
                : kind === 'sprite'
                  ? 'テンプレの立ち絵'
                  : 'テンプレの効果音')}
          </DialogTitle>
          <DialogDescription>
            {description ??
              (kind === 'bg'
                ? '分類で絞って選びます。テンプレは枚数に数えません。'
                : kind === 'sprite'
                  ? '分類で絞って選びます。テンプレの立ち絵は枚数に数えません。'
                  : '分類で絞って選びます。▶ で試聴できます。')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {categories.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="分類">
              {[{ category: ALL, count: visible.length }, ...categories].map((c) => (
                <button
                  key={c.category}
                  type="button"
                  role="tab"
                  aria-selected={category === c.category}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs',
                    category === c.category
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface',
                  )}
                  onClick={() => setCategory(c.category)}
                >
                  {c.category === ALL ? 'すべて' : categoryLabelOf(manifest, kind, c.category)}
                  <span className="ml-1 opacity-70">{c.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="text-on-surface-variant text-sm">選べるテンプレがありません。</p>
          ) : kind === 'se' ? (
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {shown.map((item) => {
                const se = item as CatalogSe
                const selected = item.key === selectedKey
                const seconds = seSeconds(se)
                return (
                  <li key={item.key} className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`${item.label}を試聴`}
                      className="shrink-0 rounded-md border border-outline-variant/30 p-2 text-primary hover:bg-surface-container-high"
                      onClick={() => playCatalogSe(se)}
                    >
                      <Play className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-surface-container-high',
                        selected ? 'border-primary' : 'border-outline-variant/30',
                      )}
                      onClick={() => {
                        onPick(item)
                        onOpenChange(false)
                      }}
                    >
                      <span>{item.label}</span>
                      <span className="ml-2 text-[11px] text-on-surface-variant">
                        {se.builtin && !se.entry ? '合成' : ''}
                        {seconds ? ` ${seconds}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul
              className={cn(
                'grid max-h-[60vh] gap-2 overflow-y-auto pr-1',
                kind === 'bg' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-5',
              )}
            >
              {shown.map((item) => {
                const selected = item.key === selectedKey
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'w-full rounded-md border p-1 text-left hover:bg-surface-container-high',
                        selected ? 'border-primary' : 'border-outline-variant/30',
                      )}
                      onClick={() => {
                        onPick(item)
                        onOpenChange(false)
                      }}
                    >
                      <img
                        src={
                          kind === 'bg'
                            ? templateBgSrc(item as CatalogBackground, 'thumb')
                            : templateSpriteSrc(item as CatalogSprite, 'thumb')
                        }
                        alt=""
                        loading="lazy"
                        className={cn(
                          'w-full rounded bg-surface-container object-cover',
                          kind === 'bg' ? 'aspect-video' : 'h-24 object-contain',
                        )}
                      />
                      <span className="mt-1 block truncate text-center text-[11px] text-on-surface-variant leading-tight">
                        {item.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
