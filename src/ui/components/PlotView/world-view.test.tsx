import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyPlot, type Plot, setWorldNote, WORLD_SLOTS } from '@/core/plot'
import type { GlossaryEntry } from '@/core/schema'
import { WorldView } from './world-view'

/**
 * 世界観設定タブ。関心は「縦に迷子にならずに書けるか」なので、
 * 一覧から項目を選ぶと右がその項目だけになること・入力欄が画面に 1 つしか無いこと・
 * 切り替えても書きかけが消えないこと・公開されないと明示されることを固定する。
 */

const plotWith = (...entries: { slot: string; title?: string; body: string }[]): Plot => {
  let p = emptyPlot('p1', 'w1', 1)
  entries.forEach((e, i) => {
    p = setWorldNote(p, e, `n${i}`, 10 + i)
  })
  return p
}

const noop = async (_name: string): Promise<string | null> => null

const GLOSSARY: GlossaryEntry[] = [
  { id: 'g1', name: 'ユキ', aliases: [], createdAt: 0, updatedAt: 0 },
]

function setup(plot: Plot = emptyPlot('p1', 'w1', 1), over: { onCreate?: typeof noop } = {}) {
  const onApply = vi.fn()
  const onCreateGlossaryEntry = vi.fn(async (name: string) => name)
  render(
    <WorldView
      plot={plot}
      onApply={onApply}
      glossary={GLOSSARY}
      onCreateGlossaryEntry={over.onCreate ?? onCreateGlossaryEntry}
    />,
  )
  // onApply は純関数を受け取る形なので、テストからは「適用後のプロット」を取り出して確かめる。
  const applied = () => {
    const fn = onApply.mock.calls.at(-1)?.[0] as ((p: Plot) => Plot) | undefined
    return fn ? fn(plot) : null
  }
  return { onApply, applied, onCreateGlossaryEntry }
}

const slot = (key: string) => {
  const found = WORLD_SLOTS.find((s) => s.key === key)
  if (!found) throw new Error(`unknown slot: ${key}`)
  return found
}

/** 左の一覧から項目を選ぶ（記入済みの項目は名前のうしろに読み上げ用の語が付く）。 */
const pick = (label: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

/** 右の入力欄（本文用の textarea。自由枠では見出しの input と 2 つになる）。 */
const editor = () => {
  const area = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA')
  if (!area) throw new Error('本文の入力欄が見つかりません')
  return area as HTMLTextAreaElement
}

describe('WorldView（世界観設定）', () => {
  it('左の一覧に全部の項目が並ぶ（畳まないので探さずに選べる）', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: '世界観設定の項目' })
    for (const s of WORLD_SLOTS) {
      expect(nav).toHaveTextContent(s.label)
    }
    expect(nav).toHaveTextContent('世界と舞台')
    expect(nav).toHaveTextContent('書き方の決め事')
    expect(nav).toHaveTextContent('読者への見せ方')
  })

  it('入力欄は画面に 1 つだけ（項目ぶん縦に積まない）', () => {
    setup(plotWith({ slot: 'stage', body: '夏の街' }, { slot: 'style', body: '一人称' }))
    expect(screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA')).toHaveLength(1)
  })

  it('既定は先頭の項目を開き、案内文と中身を右に出す', () => {
    setup(plotWith({ slot: 'stage', body: '夏の街' }))
    // 入力欄が項目名と結びついている（見出しがラベルになっている）
    expect(screen.getByLabelText(slot('stage').label)).toBe(editor())
    expect(screen.getByText(slot('stage').guide)).toBeInTheDocument()
    expect(editor().value).toBe('夏の街')
  })

  it('項目を選ぶと右がその項目に入れ替わる', () => {
    setup(plotWith({ slot: 'stage', body: '夏の街' }, { slot: 'words', body: '敬語' }))
    pick(slot('words').label)
    expect(screen.getByText(slot('words').guide)).toBeInTheDocument()
    expect(editor().value).toBe('敬語')
    // 前の項目の案内文はもう出ていない＝1 項目だけを見て書ける
    expect(screen.queryByText(slot('stage').guide)).toBeNull()
  })

  it('入力して離れると保存される', () => {
    const { onApply, applied } = setup()
    const area = editor()
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '現代の地方都市、夏' } })
    fireEvent.blur(area)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(applied()?.world[0]).toMatchObject({ slot: 'stage', body: '現代の地方都市、夏' })
  })

  it('書きかけのまま別の項目へ移っても消えない', () => {
    const { applied } = setup()
    const area = editor()
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '書きかけのまま移動' } })
    // blur を経ずに一覧をクリックする（実際に起きる操作）
    pick(slot('words').label)
    expect(applied()?.world[0]).toMatchObject({ slot: 'stage', body: '書きかけのまま移動' })
  })

  it('中身を変えずに離れても保存しない（無駄な更新を打たない）', () => {
    const { onApply } = setup(plotWith({ slot: 'stage', body: '夏の街' }))
    const area = editor()
    fireEvent.focus(area)
    fireEvent.blur(area)
    pick(slot('words').label)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('Esc は書きかけを捨てる', () => {
    const { onApply } = setup(plotWith({ slot: 'stage', body: '夏の街' }))
    const area = editor()
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '書きかけ' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    fireEvent.blur(area)
    expect(onApply).not.toHaveBeenCalled()
    expect(area.value).toBe('夏の街')
  })

  it('記入済みの項目と件数が分かる', () => {
    setup(plotWith({ slot: 'stage', body: 'a' }, { slot: 'style', body: 'b' }))
    expect(screen.getByText(`2 / ${WORLD_SLOTS.length} の枠に記入済み`)).toBeInTheDocument()
    expect(screen.getAllByText('記入済み')).toHaveLength(2)
  })

  it('公開されない場所であることを明示する', () => {
    setup()
    expect(screen.getByText('公開されません')).toBeInTheDocument()
    expect(screen.getByText(/読者に見せる人物や用語の説明は「用語集」へ/)).toBeInTheDocument()
  })

  it('作品によって要らない枠は「任意」と分かる', () => {
    setup()
    expect(screen.getAllByText('任意').length).toBeGreaterThan(0)
    expect(slot('special').optional).toBe(true)
  })

  it('メモを足すと、その場で選ばれて書き始められる', () => {
    const { applied } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'メモを足す' }))
    // 見出しだけで本文が空のまま残る＝足した直後に離れても消えない
    expect(applied()?.world[0]).toMatchObject({ slot: 'custom', title: '新しいメモ', body: '' })
  })

  it('自由枠だけ見出しを編集でき、削除できる', () => {
    const { applied } = setup(plotWith({ slot: 'custom', title: '食べ物', body: '麦' }))
    pick('食べ物')
    const heading = screen.getByLabelText('メモの見出し') as HTMLInputElement
    expect(heading.value).toBe('食べ物')
    fireEvent.focus(heading)
    fireEvent.change(heading, { target: { value: '食べ物と酒' } })
    fireEvent.blur(heading)
    expect(applied()?.world[0]?.title).toBe('食べ物と酒')

    fireEvent.click(screen.getByRole('button', { name: '食べ物を削除' }))
    expect(applied()?.world).toEqual([])
  })

  // 本文・プロットと同じ記法をここでも使えるようにした（器が違っても書き方は 1 つ）。
  it('@ で用語集のサジェストが出て、選ぶと [[名前]] が入る', async () => {
    const { applied } = setup()
    const area = editor()
    fireEvent.focus(area)
    // @ の直前が文字だと発火しない（メールの逃げ道）ので、行頭から打つ
    fireEvent.change(area, { target: { value: '@' } })
    const option = await screen.findByText('ユキ')
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    fireEvent.blur(area)
    expect(applied()?.world[0]?.body).toBe('[[ユキ]]')
  })

  it('[[ でもサジェストが出る', async () => {
    setup()
    const area = editor()
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '舞台は[[' } })
    expect(await screen.findByText('ユキ')).toBeInTheDocument()
  })

  it('用語集に無い語は、その場で登録してから挿入される', async () => {
    const onCreate = vi.fn(async (name: string) => name)
    const { applied } = setup(emptyPlot('p1', 'w1', 1), { onCreate })
    const area = editor()
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: '@灰嶺' } })
    const create = await screen.findByText(/「灰嶺」を新規作成/)
    fireEvent.click(create)
    await screen.findByDisplayValue('[[灰嶺]]')
    expect(onCreate).toHaveBeenCalledWith('灰嶺')
    fireEvent.blur(area)
    expect(applied()?.world[0]?.body).toBe('[[灰嶺]]')
  })

  it('記法が使えることを画面で案内する', () => {
    setup()
    expect(screen.getByText(/@ または \[\[ で用語集を呼び出せます/)).toBeInTheDocument()
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
