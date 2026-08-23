import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '@/core/schema'
import { GlossaryEntryForm } from './glossary-entry-form'

/**
 * 「表示中のフォームは props の変化で巻き戻らない」ことの回帰テスト。
 * 自動同期（pull 後の store.init()）で親が任意のタイミングで再レンダーされるようになったため、
 * initial の参照・値が変わっても、開いている間は入力途中のフィールドを保持しなければならない
 * （stg で報告された「用語集の入力中データがしばらくすると消える」の再発防止）。
 */

const entry = (over: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  id: 'e1',
  name: 'アリス',
  aliases: [],
  category: '人物',
  reading: '',
  summary: '最初の概要',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const nameInput = () => screen.getByLabelText('名前') as HTMLInputElement
const summaryInput = () => screen.getByLabelText('概要（任意）') as HTMLTextAreaElement

describe('GlossaryEntryForm: 表示中は初期値へ巻き戻さない', () => {
  it('initial の参照が変わる再レンダーでも入力途中の値を保持する', () => {
    const { rerender } = render(
      <GlossaryEntryForm
        open
        onOpenChange={() => {}}
        mode="edit"
        initial={entry()}
        onSubmit={() => {}}
      />,
    )
    fireEvent.change(summaryInput(), { target: { value: '書きかけの説明' } })

    // 親の再レンダー（例：同期 pull 後の store.init()）＝ initial が新しいオブジェクトになる
    rerender(
      <GlossaryEntryForm
        open
        onOpenChange={() => {}}
        mode="edit"
        initial={entry()}
        onSubmit={() => {}}
      />,
    )
    expect(summaryInput().value).toBe('書きかけの説明')

    // initial の中身（値）が変わっても表示中は追従しない＝入力を優先する
    rerender(
      <GlossaryEntryForm
        open
        onOpenChange={() => {}}
        mode="edit"
        initial={entry({ summary: '別端末からの概要' })}
        onSubmit={() => {}}
      />,
    )
    expect(summaryInput().value).toBe('書きかけの説明')
  })

  it('閉じて開き直したときは最新の初期値へ同期する', () => {
    const props = { onOpenChange: () => {}, mode: 'edit' as const, onSubmit: () => {} }
    const { rerender } = render(<GlossaryEntryForm open {...props} initial={entry()} />)
    fireEvent.change(nameInput(), { target: { value: '入力途中' } })

    rerender(<GlossaryEntryForm open={false} {...props} initial={entry()} />)
    rerender(<GlossaryEntryForm open {...props} initial={entry({ name: '最新の名前' })} />)
    expect(nameInput().value).toBe('最新の名前')
  })

  it('クイック作成（initial がインライン生成）でも再レンダーで消えない', () => {
    const { rerender } = render(
      <GlossaryEntryForm
        open
        onOpenChange={() => {}}
        mode="create"
        initial={{ name: 'プリフィル' }}
        onSubmit={() => {}}
      />,
    )
    fireEvent.change(summaryInput(), { target: { value: '説明を書いている' } })
    // 再レンダーごとに initial は新しいオブジェクト（App のインライン生成を再現）
    rerender(
      <GlossaryEntryForm
        open
        onOpenChange={() => {}}
        mode="create"
        initial={{ name: 'プリフィル' }}
        onSubmit={() => {}}
      />,
    )
    expect(nameInput().value).toBe('プリフィル')
    expect(summaryInput().value).toBe('説明を書いている')
  })
})
