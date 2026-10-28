import { type NotationKind, notationItems, notationShortcut } from './notation'

/** 通常表示と集中表示で共用する記法・ショートカット。 */
export function NotationButtons({
  scriptMode = false,
  onApply,
}: {
  scriptMode?: boolean
  onApply: (kind: NotationKind) => void
}) {
  return (
    <>
      {notationItems(scriptMode).map((item) => (
        <button
          key={item.kind}
          type="button"
          title={`${item.hint}（${notationShortcut(item)}）`}
          aria-label={item.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApply(item.kind)}
          className="flex min-h-11 shrink-0 flex-col items-center justify-center whitespace-nowrap rounded-md px-2.5 font-sans text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          {item.label}
          <kbd aria-hidden className="mt-0.5 text-[10px] leading-tight opacity-60">
            {notationShortcut(item)}
          </kbd>
        </button>
      ))}
    </>
  )
}
