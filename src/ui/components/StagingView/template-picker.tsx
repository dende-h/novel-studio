import { useMemo, useState } from 'react'
import {
  type CatalogBackground,
  type CatalogSprite,
  categoriesOf,
  categoryLabelOf,
  type TemplateKind,
  type TemplateManifest,
  visibleTemplates,
} from '@/core/game/templates'
import { cn } from '@/lib/utils'
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

type Item = CatalogBackground | CatalogSprite

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
            {title ?? (kind === 'bg' ? 'テンプレの背景' : 'テンプレの立ち絵')}
          </DialogTitle>
          <DialogDescription>
            {description ??
              (kind === 'bg'
                ? '分類で絞って選びます。テンプレは枚数に数えません。'
                : '分類で絞って選びます。テンプレの立ち絵は枚数に数えません。')}
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
