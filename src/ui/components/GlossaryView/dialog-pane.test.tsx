import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry } from '@/core/schema'
import { DialogPane } from './dialog-pane'

function entry(p: Partial<GlossaryEntry> & { id: string; name: string }): GlossaryEntry {
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    category: p.category,
    reading: p.reading,
    summary: p.summary,
    dialog: p.dialog,
    dialogVersion: p.dialogVersion,
    createdAt: 0,
    updatedAt: 0,
  }
}

const OTHERS = [entry({ id: 'x', name: 'ボブ', category: '人物' })]

/** onChange を反映して描き直す stateful なハーネス。 */
function setup(initial: GlossaryEntry, opts: { draft?: boolean; failOnce?: boolean } = {}) {
  const onChange = vi.fn()
  const onToForm = vi.fn()
  let failed = false
  function Harness() {
    const [e, setE] = useState(initial)
    return (
      <DialogPane
        entry={e}
        isDraft={opts.draft ?? false}
        entries={[e, ...OTHERS]}
        resolvedNames={new Set(['ボブ'])}
        onChange={async (next) => {
          onChange(next)
          if (opts.failOnce && !failed) {
            failed = true
            throw new Error('保存に失敗しました（テスト）')
          }
          setE(next)
        }}
        onToForm={onToForm}
        onRefClick={() => {}}
      />
    )
  }
  render(<Harness />)
  return { onChange, onToForm }
}

const pane = () => screen.getByRole('region', { name: '対話' })
const lastBot = () => {
  const bubbles = pane().querySelectorAll('.rounded-bl-md')
  return bubbles[bubbles.length - 1]?.textContent ?? ''
}
const box = () => screen.getByLabelText('答え') as HTMLTextAreaElement

describe('DialogPane（キー操作と保存）', () => {
  it('Enter で決定し、Shift+Enter・IME 変換中の Enter は決定しない', () => {
    const { onChange } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }))
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dialog: { title: { text: '灯台守', public: true } } }),
    )
    // 次の問いへ移ると欄は空で新しく出る
    expect(lastBot()).toBe('アリスの年齢か、年の頃を教えてください。')
    expect(box().value).toBe('')
  })

  it('「答える」ボタンでも決定でき、空白だけなら何もしない', () => {
    const { onChange } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }))
    fireEvent.change(box(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '答える' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.click(screen.getByRole('button', { name: '答える' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('@ の候補が開いている間の Enter は候補の確定で、[[名前]] が入る（決定しない）', async () => {
    const { onChange } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }))
    // 関係の問いまで飛ばす代わりに、最初の問いでそのまま試す
    fireEvent.change(box(), { target: { value: '相棒は @ボ' } })
    const list = await screen.findByRole('listbox')
    expect(within(list).getByRole('option', { name: /ボブ/ })).toBeInTheDocument()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(box().value).toBe('相棒は [[ボブ]]'))
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dialog: { title: { text: '相棒は [[ボブ]]', public: true } } }),
    )
    // 答えの吹き出しでは [[ボブ]] がリンクになる
    expect(within(pane()).getByRole('link', { name: 'ボブ' })).toBeInTheDocument()
  })

  it('保存に失敗すると対話の中で知らせ、保存前の状態から失敗した問いを聞き直す', async () => {
    const { onChange } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }), {
      failOnce: true,
    })
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(lastBot()).toBe('保存に失敗しました（テスト）'))
    // 保存できなかった答えは手元にも残さず、同じ問い（役職）を待つ＝次に答えたぶんが正しく保存される
    fireEvent.change(box(), { target: { value: '灯台守（再）' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dialog: { title: { text: '灯台守（再）', public: true } } }),
    )
    await waitFor(() => expect(lastBot()).toBe('アリスの年齢か、年の頃を教えてください。'))
  })

  it('ひと通り答えたまとめで「読者に見せる」の答えから公開情報の下書きを作り、欄に入れられる', async () => {
    const e = entry({ id: 'a', name: 'アリス', category: '人物', summary: '主人公。' })
    const { onChange, onToForm } = setup(e)
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    let guard = 0
    while (screen.queryByRole('button', { name: 'スキップ' }) && guard++ < 60) {
      fireEvent.click(screen.getByRole('button', { name: 'スキップ' }))
      const dig = screen.queryByRole('button', { name: '次へ' })
      if (dig) fireEvent.click(dig)
    }
    expect(lastBot()).toBe('ひと通り聞きました。まとめはこちらです。')
    fireEvent.click(
      screen.getByRole('button', { name: '「読者に見せる」の答えから公開情報の下書きを作る' }),
    )
    expect(screen.getByLabelText('公開情報の下書き')).toHaveTextContent(
      '主人公。 役職・肩書き：灯台守',
    )
    fireEvent.click(screen.getByRole('button', { name: '公開情報の欄に入れる' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ summary: '主人公。\n役職・肩書き：灯台守' }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'フォームで確かめる' }))
    expect(onToForm).toHaveBeenCalled()
  })

  it('名前を飛ばして「用語集に登録する」を押すと名前を聞き直し、スキップとあとでは出ない', () => {
    const onFinish = vi.fn(async () => {})
    render(
      <DialogPane
        entry={entry({ id: 'd', name: '', category: '人物' })}
        isDraft
        entries={OTHERS}
        resolvedNames={new Set()}
        onChange={() => {}}
        onFinish={onFinish}
        onToForm={() => {}}
      />,
    )
    // 下書き：分類は先に入っているが台本は分類から聞く
    fireEvent.click(screen.getByRole('button', { name: '人物' }))
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' })) // 名前
    let guard = 0
    while (screen.queryByRole('button', { name: 'スキップ' }) && guard++ < 60) {
      fireEvent.click(screen.getByRole('button', { name: 'スキップ' }))
      const dig = screen.queryByRole('button', { name: '次へ' })
      if (dig) fireEvent.click(dig)
    }
    fireEvent.click(screen.getByRole('button', { name: '用語集に登録する' }))
    expect(onFinish).not.toHaveBeenCalled()
    expect(lastBot()).toBe('まず、名前を教えてください。')
    expect(screen.queryByRole('button', { name: 'スキップ' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'あとで答える' })).toBeNull()
    fireEvent.change(box(), { target: { value: 'ミア' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'これで登録する' }))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ name: 'ミア' }))
  })

  it('種類だけの問い（場所）は選択肢のチップだけで、入力欄とスキップを出さない', () => {
    setup(entry({ id: 'p', name: '王都', category: '場所' }))
    expect(lastBot()).toBe('王都はどんな種類の場所ですか。')
    expect(screen.queryByLabelText('答え')).toBeNull()
    expect(screen.queryByRole('button', { name: 'スキップ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '国・地方' }))
    expect(lastBot()).toBe('王都はどこにあって、どうやって行きますか。')
    expect(screen.getByLabelText('答え')).toBeInTheDocument()
  })
})
