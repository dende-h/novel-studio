import type { CSSProperties } from 'react'
import type { SheetOptions, SheetPage } from '@/core/script/layout'
import { cn } from '@/lib/utils'

/**
 * 脚本の原稿用紙（プレビュー）。core/script/layout が組んだ頁を、1マス1文字でそのまま描く。
 * 紙の寸法は持たず、文字の大きさは設定の読書サイズ（--reading-font-size）に従う。
 * 出力はテキスト（toScriptText）なので、ここは枚数と体裁を確かめるための画面。
 */

export type SheetWriting = 'vertical' | 'horizontal'

export interface SheetPreset extends SheetOptions {
  writing: SheetWriting
  label: string
}

/**
 * マス目の比率（index.css の .sheet と同じ値）。字送り＝読書サイズ×1.25、行送り＝×2。
 * 紙の横幅を JS で見積もって欄に収める縮尺を出すために、ここにも持つ。
 */
export const SHEET_CHAR_RATIO = 1.25
export const SHEET_LINE_RATIO = 2
/** 紙の左右の余白（px・CSS の .sheet-page の padding と同じ）。 */
export const SHEET_PAGE_PAD_X = 48

/** 縦書きなら行数×行送り、横書きなら字数×字送りが紙の横幅になる。 */
export function sheetPageWidthPx(preset: SheetPreset, fontPx: number): number {
  const body =
    preset.writing === 'vertical'
      ? preset.rows * fontPx * SHEET_LINE_RATIO
      : preset.cols * fontPx * SHEET_CHAR_RATIO
  return body + SHEET_PAGE_PAD_X
}

/** 縦書き 20字×20行（映像業界の標準ペラ）と、横書き 40字×40行（募集要項で指定されることがある）。 */
export const SHEET_PRESETS: Record<SheetWriting, SheetPreset> = {
  vertical: { writing: 'vertical', cols: 20, rows: 20, label: '縦書き 20字×20行' },
  horizontal: { writing: 'horizontal', cols: 40, rows: 40, label: '横書き 40字×40行' },
}

interface ScriptSheetProps {
  pages: SheetPage[]
  preset: SheetPreset
  /** 紙を欄に収める縮尺（1 = 原寸）。 */
  scale?: number
  className?: string
}

export function ScriptSheet({ pages, preset, scale = 1, className }: ScriptSheetProps) {
  const style = {
    '--sheet-cols': preset.cols,
    '--sheet-rows': preset.rows,
    '--sheet-scale': scale,
  } as CSSProperties
  return (
    <div
      className={cn('sheet', `sheet--${preset.writing}`, className)}
      style={style}
      data-sheet-pages={pages.length}
    >
      {pages.map((page, pageIndex) => (
        <section
          // 前付けの頁は番号を持たないので並び順で識別する
          // biome-ignore lint/suspicious/noArrayIndexKey: 頁の識別子は無く、並び順が意味
          key={pageIndex}
          className="sheet-page"
          aria-label={page.number ? `${page.number}頁` : '前付け'}
        >
          <div className="sheet-body">
            {page.lines.map((line, i) => (
              <p
                // 行は位置で同一視してよい（頁ごとに描き直す）
                // biome-ignore lint/suspicious/noArrayIndexKey: 行の識別子は無く、並び順が意味
                key={i}
                className={cn('sheet-line', `sheet-line--${line.kind}`)}
              >
                {line.text || '\u3000'}
              </p>
            ))}
          </div>
          {page.number ? (
            <div className="sheet-number" aria-hidden>
              {page.number}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}
