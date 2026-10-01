import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { composeScriptSheet, layoutScriptBlocks, paginate } from '@/core/script/layout'
import { ScriptSheet, SHEET_PRESETS, sheetPageWidthPx } from './script-sheet'
import { ScriptSheetView } from './script-sheet-view'

const pagesOf = (body: string, writing: 'vertical' | 'horizontal' = 'vertical') => {
  const preset = SHEET_PRESETS[writing]
  return paginate(layoutScriptBlocks(parseEpisodeBody(body), preset), preset)
}

describe('ScriptSheet（原稿用紙）', () => {
  it('頁ごとにノンブルを付け、行の種類をクラスで示す。空行も1行分のマスを取る', () => {
    const { container } = render(
      <ScriptSheet
        pages={pagesOf('○公園\n風が吹く\n\nユイ「はい」')}
        preset={SHEET_PRESETS.vertical}
      />,
    )
    expect(container.querySelector('.sheet')).toHaveAttribute('data-sheet-pages', '1')
    expect(container.querySelector('.sheet--vertical')).not.toBeNull()
    expect(screen.getByLabelText('1頁')).toBeInTheDocument()
    const lines = [...container.querySelectorAll('.sheet-line')]
    expect(lines.map((l) => l.className.replace('sheet-line ', ''))).toEqual([
      'sheet-line--slug',
      'sheet-line--direction',
      'sheet-line--blank',
      'sheet-line--dialogue',
    ])
    expect(lines[1]?.textContent).toBe('　　　風が吹く')
    expect(lines[2]?.textContent).toBe('　')
  })
  it('20字×20行を超えると頁が増え、横書き 40×40 では減る', () => {
    const body = Array.from({ length: 30 }, (_, i) => `${i}行目の文`).join('\n')
    expect(pagesOf(body)).toHaveLength(2)
    expect(pagesOf(body, 'horizontal')).toHaveLength(1)
  })
  it('前付けの頁にはノンブルを付けず、本文の最初の頁を 1 とする', () => {
    const preset = SHEET_PRESETS.vertical
    const pages = composeScriptSheet(
      { title: 'T', author: 'A', episodes: [{ title: '', blocks: parseEpisodeBody('風') }] },
      { cover: true, cast: false, synopsis: false },
      preset,
    )
    render(<ScriptSheet pages={pages} preset={preset} />)
    expect(screen.getByLabelText('前付け')).toBeInTheDocument()
    expect(screen.getByLabelText('1頁')).toBeInTheDocument()
    expect(screen.queryByLabelText('2頁')).toBeNull()
  })
})

describe('sheetPageWidthPx', () => {
  it('縦書きは行数×行送り、横書きは字数×字送りに左右余白を足す', () => {
    expect(sheetPageWidthPx(SHEET_PRESETS.vertical, 15)).toBe(20 * 30 + 48)
    expect(sheetPageWidthPx(SHEET_PRESETS.horizontal, 16)).toBe(40 * 20 + 48)
  })
})

describe('ScriptSheetView（プレビュー）', () => {
  it('用紙の型と枚数を見出しに出し、本文が無ければ案内だけ出す', () => {
    const { rerender } = render(
      <ScriptSheetView pages={pagesOf('風\n雨')} preset={SHEET_PRESETS.vertical} />,
    )
    expect(screen.getByText('縦書き 20字×20行・本編 1 枚')).toBeInTheDocument()
    rerender(<ScriptSheetView pages={[]} preset={SHEET_PRESETS.horizontal} />)
    expect(screen.getByText('横書き 40字×40行・本編 0 枚')).toBeInTheDocument()
    expect(screen.getByText(/原稿用紙の形で表示されます/)).toBeInTheDocument()
  })
})
