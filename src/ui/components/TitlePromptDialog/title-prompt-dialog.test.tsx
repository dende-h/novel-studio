import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TitlePromptDialog } from './title-prompt-dialog'

function renderDialog(defaultValue: string, onSubmit = vi.fn()) {
  render(
    <TitlePromptDialog
      open
      onOpenChange={() => {}}
      title="話のタイトルを変更"
      label="話タイトル"
      defaultValue={defaultValue}
      submitLabel="変更"
      maxLength={50}
      onSubmit={onSubmit}
    />,
  )
  return onSubmit
}

describe('TitlePromptDialog の文字数の上限', () => {
  it('上限以内なら文字数を出して決定できる', () => {
    const onSubmit = renderDialog('第1話')
    expect(screen.getByText('3／50文字')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '変更' }))
    expect(onSubmit).toHaveBeenCalledWith('第1話')
  })

  it('上限を超える既存のタイトルは開けるが、短くするまで決定できない', () => {
    const onSubmit = renderDialog('あ'.repeat(60))
    expect(screen.getByText('50文字までです（いま60文字）')).toBeTruthy()
    const submit = screen.getByRole('button', { name: '変更' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('話タイトル'), { target: { value: 'あ'.repeat(50) } })
    expect((screen.getByRole('button', { name: '変更' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
