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
function setup(
  initial: GlossaryEntry,
  opts: { draft?: boolean; failOnce?: boolean; hold?: () => Promise<void> } = {},
) {
  const onChange = vi.fn()
  const onToForm = vi.fn()
  let failed = false
  function Harness() {
    const [e, setE] = useState(initial)
    return (
      <DialogPane
        entry={e}
        unsaved={opts.draft ?? false}
        entries={[e, ...OTHERS]}
        resolvedNames={new Set(['ボブ'])}
        onChange={async (next, prev) => {
          onChange(next, prev)
          if (opts.hold) await opts.hold()
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
      expect.anything(),
    )
    // 次の問いへ移ると欄は空で新しく出る
    expect(lastBot()).toBe('アリスの年齢か、年の頃を教えてください。')
    expect(box().value).toBe('')
  })

  it('受け付けなかった答え（重複する名前）は入力欄に残り、直して出し直せる', () => {
    render(
      <DialogPane
        entry={entry({ id: 'd', name: '', category: '人物' })}
        unsaved
        entries={OTHERS}
        resolvedNames={new Set()}
        onChange={() => {}}
        onToForm={() => {}}
      />,
    )
    fireEvent.change(box(), { target: { value: 'ボブ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(lastBot()).toMatch(/もうあります/)
    expect(box().value).toBe('ボブ')
  })

  it('保存が同時に走っても、差分は最後に保存できた状態を基準に取る（先の保存が落ちても答えが残る）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { onChange } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }), {
      hold: () => gate,
    })
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.change(box(), { target: { value: '十七' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    // 2 回目の保存の基準（prev）は、まだ保存が終わっていない 1 回目ではなく元の項目
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1]?.[1]).toMatchObject({ dialog: undefined })
    expect(onChange.mock.calls[1]?.[0]).toMatchObject({
      dialog: { title: { text: '灯台守', public: true }, age: { text: '十七', public: true } },
    })
    release()
    await waitFor(() => expect(lastBot()).not.toBe(''))
  })

  it('Esc を押しても書きかけの答えは消えない', () => {
    setup(entry({ id: 'a', name: 'アリス', category: '人物' }))
    fireEvent.change(box(), { target: { value: '灯台守' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box().value).toBe('灯台守')
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
      expect.anything(),
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
    // 保存できなかった答えは手元にも残さず、同じ問い（役職）を待つ＝次に答えたぶんが正しく保存される。
    // 打った答えは入力欄へ戻る（打ち直さなくてよい）
    expect(box().value).toBe('灯台守')
    fireEvent.change(box(), { target: { value: '灯台守（再）' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dialog: { title: { text: '灯台守（再）', public: true } } }),
      expect.anything(),
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
    expect(lastBot()).toMatch(/^ひと通り聞きました。まとめはこちらです/)
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
        expect.anything(),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'フォームで確かめる' }))
    expect(onToForm).toHaveBeenCalled()
  })

  it('名前の問いにはスキップが無く、答えると登録の一言と会話を親へ渡す（登録された項目で続ける）', () => {
    const onChange = vi.fn()
    render(
      <DialogPane
        entry={entry({ id: 'd', name: '', category: '人物' })}
        unsaved
        entries={OTHERS}
        resolvedNames={new Set()}
        onChange={onChange}
        onToForm={() => {}}
      />,
    )
    // 分類が先に入っているので、分類は聞かず名前から。名前は飛ばせない
    expect(lastBot()).toBe('まず、名前を教えてください。')
    expect(screen.queryByRole('button', { name: 'スキップ' })).toBeNull()
    fireEvent.change(box(), { target: { value: 'ミア' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ミア' }),
      expect.anything(),
      expect.objectContaining({ unsaved: true, pending: { kind: 'question', key: 'reading' } }),
    )
    expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。')
  })

  it('名前での登録に失敗すると一歩だけ戻る（書き出しを繰り返さず、登録の一言も残さない）', async () => {
    setup(entry({ id: 'd', name: '', category: '人物' }), { draft: true, failOnce: true })
    fireEvent.change(box(), { target: { value: 'ミア' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(lastBot()).toBe('保存に失敗しました（テスト）'))
    const bots = [...pane().querySelectorAll('.rounded-bl-md')].map((b) => b.textContent ?? '')
    expect(bots.filter((t) => t.startsWith('新しい項目を作ります'))).toHaveLength(1)
    expect(bots.some((t) => t.includes('登録しました'))).toBe(false)
    // 同じ問い（名前）を待ち、打った名前は入力欄に戻る
    expect(screen.queryByRole('button', { name: 'スキップ' })).toBeNull()
    expect(box().value).toBe('ミア')
    fireEvent.change(box(), { target: { value: 'ミア' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() =>
      expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。'),
    )
  })

  it('「対話を終える」でフォームに戻る', () => {
    const { onToForm } = setup(entry({ id: 'a', name: 'アリス', category: '人物' }))
    fireEvent.click(screen.getByRole('button', { name: '対話を終える' }))
    expect(onToForm).toHaveBeenCalled()
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
