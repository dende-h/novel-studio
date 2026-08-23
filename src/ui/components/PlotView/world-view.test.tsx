import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyPlot, type Plot, setWorldNote, WORLD_SLOTS } from '@/core/plot'
import { WorldView } from './world-view'

/**
 * 世界観設定タブ。関心は「整理が苦手な人でも埋められるか」なので、
 * 枠と案内文が読めること・書いた内容が確定すること・畳んでも中身の在りかが分かること・
 * 公開されないと明示されることを固定する。
 */

const plotWith = (...entries: { slot: string; title?: string; body: string }[]): Plot => {
  let p = emptyPlot('p1', 'w1', 1)
  entries.forEach((e, i) => {
    p = setWorldNote(p, e, `n${i}`, 10 + i)
  })
  return p
}

function setup(plot: Plot = emptyPlot('p1', 'w1', 1)) {
  const onApply = vi.fn()
  const view = render(<WorldView plot={plot} onApply={onApply} />)
  // onApply は純関数を受け取る形なので、テストからは「適用後のプロット」を取り出して確かめる。
  const applied = () => {
    const fn = onApply.mock.calls.at(-1)?.[0] as ((p: Plot) => Plot) | undefined
    return fn ? fn(plot) : null
  }
  return { onApply, applied, view }
}

/** アコーディオンのまとまりを開く（畳んだ中身は DOM に出ないため）。 */
const openSection = (label: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

const slot = (key: string) => {
  const found = WORLD_SLOTS.find((s) => s.key === key)
  if (!found) throw new Error(`unknown slot: ${key}`)
  return found
}

describe('WorldView（世界観設定）', () => {
  it('既定では最初のまとまりだけ開き、残りは畳んでおく', () => {
    setup()
    // 開いている「世界と舞台」の枠は入力欄まで出る
    expect(screen.getByLabelText(slot('stage').label)).toBeInTheDocument()
    // 畳んだまとまりの枠は DOM に出ない（画面が最初から長大にならない）
    expect(screen.queryByLabelText(slot('style').label)).toBeNull()
    // それでも見出しは並んでいるので、どこに何があるかは分かる
    expect(screen.getByRole('button', { name: /書き方の決め事/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /読者への見せ方/ })).toBeInTheDocument()
  })

  it('まとまりを開くと、その枠と案内文がすべて読める', () => {
    setup()
    openSection('書き方の決め事')
    for (const s of WORLD_SLOTS.filter((x) => x.group === 'writing')) {
      expect(screen.getByLabelText(s.label)).toBeInTheDocument()
      expect(screen.getByText(s.guide)).toBeInTheDocument()
    }
  })

  it('「すべて開く」で全部の枠が出る', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'すべて開く' }))
    for (const s of WORLD_SLOTS) expect(screen.getByLabelText(s.label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて閉じる' })).toBeInTheDocument()
  })

  it('畳んだままでも、まとまりごとの記入数が見出しに出る（中身を見失わせない）', () => {
    // style は「書き方の決め事」＝既定で畳まれているまとまり
    setup(plotWith({ slot: 'style', body: '一人称' }, { slot: 'words', body: '敬語' }))
    expect(screen.getByRole('button', { name: /書き方の決め事/ })).toHaveTextContent('2 / 4')
    expect(screen.getByRole('button', { name: /読者への見せ方/ })).toHaveTextContent('0 / 2')
    expect(screen.getByText(`2 / ${WORLD_SLOTS.length} の枠に記入済み`)).toBeInTheDocument()
  })

  it('公開されない場所であることを明示する', () => {
    setup()
    expect(screen.getAllByText('公開されません').length).toBeGreaterThan(0)
    expect(screen.getByText(/読者が読む人物や用語の説明は「用語集」へ/)).toBeInTheDocument()
  })

  it('入力して離れると保存される', () => {
    const { onApply, applied } = setup()
    const area = screen.getByLabelText(slot('stage').label)
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '現代の地方都市、夏' } })
    fireEvent.blur(area)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(applied()?.world[0]).toMatchObject({ slot: 'stage', body: '現代の地方都市、夏' })
  })

  it('中身を変えずに離れても保存しない（無駄な更新を打たない）', () => {
    const { onApply } = setup(plotWith({ slot: 'stage', body: '夏の街' }))
    const area = screen.getByLabelText(slot('stage').label)
    fireEvent.focus(area)
    fireEvent.blur(area)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('Esc は書きかけを捨てる', () => {
    const { onApply } = setup(plotWith({ slot: 'stage', body: '夏の街' }))
    const area = screen.getByLabelText(slot('stage').label) as HTMLTextAreaElement
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '書きかけ' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    fireEvent.blur(area)
    expect(onApply).not.toHaveBeenCalled()
    expect(area.value).toBe('夏の街')
  })

  it('まとまりを畳んでも書きかけを取りこぼさない', () => {
    const { applied } = setup()
    const area = screen.getByLabelText(slot('stage').label)
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '書きかけのまま畳む' } })
    // blur を経ずに畳む（欄が外れる）
    openSection('世界と舞台')
    expect(applied()?.world[0]).toMatchObject({ slot: 'stage', body: '書きかけのまま畳む' })
  })

  it('作品によって要らない枠は「任意」と分かる', () => {
    setup()
    expect(screen.getByText('任意')).toBeInTheDocument()
    expect(slot('special').optional).toBe(true)
  })

  it('自由枠は見出しを付けて足せる', () => {
    const { applied } = setup()
    openSection('そのほか')
    fireEvent.click(screen.getByRole('button', { name: 'メモを足す' }))
    expect(applied()?.world[0]).toMatchObject({ slot: 'custom', title: '新しいメモ' })
  })

  it('自由枠だけ見出しを編集でき、削除できる', () => {
    const { applied } = setup(plotWith({ slot: 'custom', title: '食べ物', body: '麦' }))
    openSection('そのほか')
    const heading = screen.getByLabelText('メモの見出し') as HTMLInputElement
    expect(heading.value).toBe('食べ物')
    fireEvent.focus(heading)
    fireEvent.change(heading, { target: { value: '食べ物と酒' } })
    fireEvent.blur(heading)
    expect(applied()?.world[0]?.title).toBe('食べ物と酒')

    fireEvent.click(screen.getByRole('button', { name: '食べ物を削除' }))
    expect(applied()?.world).toEqual([])
  })

  it('定型枠には削除ボタンを出さない（枠そのものは消えない）', () => {
    setup(plotWith({ slot: 'stage', body: '夏の街' }))
    expect(screen.queryByRole('button', { name: `${slot('stage').label}を削除` })).toBeNull()
  })
})

describe('WORLD_SLOTS（ジャンルを選ばないこと）', () => {
  // 異世界物を前提にした語を置くと、現代物・ミステリ・恋愛の作者に空欄を押しつけることになる。
  // 現実に無い仕組みの話は optional な 1 枠へ畳んである、という設計を固定する。
  const FANTASY_WORDS = ['魔法', '種族', '魔力', 'エルフ', '異世界', '王国', '剣']

  it('枠のラベルと案内文に特定ジャンルの語を持ち込まない', () => {
    for (const s of WORLD_SLOTS) {
      if (s.optional) continue // 固有の仕組みの枠だけは例示に使ってよい
      for (const word of FANTASY_WORDS) {
        expect(`${s.label}${s.guide}`).not.toContain(word)
      }
    }
  })

  it('現実に無い仕組みの枠は 1 つだけで、任意である', () => {
    const optional = WORLD_SLOTS.filter((s) => s.optional)
    expect(optional).toHaveLength(1)
    expect(optional[0]?.key).toBe('special')
    expect(optional[0]?.guide).toContain('無ければ空のまま')
  })

  it('どの枠も 3 つのまとまりのどれかに属する', () => {
    for (const s of WORLD_SLOTS) {
      expect(['world', 'writing', 'reader']).toContain(s.group)
    }
  })
})
