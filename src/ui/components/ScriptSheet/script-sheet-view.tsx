import { useLayoutEffect, useRef, useState } from 'react'
import type { SheetPage } from '@/core/script/layout'
import { ScriptSheet, type SheetPreset, sheetPageWidthPx } from './script-sheet'

interface ScriptSheetViewProps {
  pages: SheetPage[]
  preset: SheetPreset
}

/** 設定の読書サイズ（--reading-font-size）を px で読む。取れなければ既定の 15px。 */
function readingFontPx(): number {
  if (typeof getComputedStyle === 'undefined') return 15
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--reading-font-size')
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 15
}

/**
 * エディタ横のプレビュー用。原稿用紙を上から順に並べ、上に「本編 n 枚」を出して
 * 書き手が枚数を見ながら書けるようにする。紙が欄より広いときは縮めて収める
 * （縦書きは1列目が右端に来るので、はみ出すと肝心の柱が見えなくなる）。
 */
export function ScriptSheetView({ pages, preset }: ScriptSheetViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const width = el.clientWidth - 32
      const natural = sheetPageWidthPx(preset, readingFontPx())
      setScale(width > 0 && natural > 0 ? Math.min(1, width / natural) : 1)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [preset])
  return (
    <div
      ref={ref}
      className="h-full min-h-0 overflow-y-auto overscroll-contain bg-surface-variant px-4 py-4"
    >
      <p className="mb-3 text-center font-sans text-[11px] text-on-surface-variant">
        {preset.label}・本編 {pages.length} 枚
      </p>
      {pages.length === 0 ? (
        <p className="text-center font-sans text-[13px] text-on-surface-variant/70">
          本文を書くと、ここに原稿用紙の形で表示されます。
        </p>
      ) : (
        <ScriptSheet pages={pages} preset={preset} scale={scale} />
      )}
    </div>
  )
}
