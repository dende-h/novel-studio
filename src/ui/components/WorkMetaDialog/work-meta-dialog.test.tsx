import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkMetaDialog } from './work-meta-dialog'

describe('WorkMetaDialog（作品メタ編集）', () => {
  it('初期値をフォームへ反映する', () => {
    render(
      <WorkMetaDialog
        open
        onOpenChange={() => {}}
        initial={{ title: '作品', author: '著者', description: 'あらすじ本文' }}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByLabelText('タイトル')).toHaveValue('作品')
    expect(screen.getByLabelText('著者')).toHaveValue('著者')
    expect(screen.getByLabelText('あらすじ')).toHaveValue('あらすじ本文')
  })

  it('保存で trim した値を onSubmit へ渡して閉じる', () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <WorkMetaDialog
        open
        onOpenChange={onOpenChange}
        initial={{ title: '旧題', author: '', description: '' }}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: ' 新題 ' } })
    fireEvent.change(screen.getByLabelText('著者'), { target: { value: ' 山田太郎 ' } })
    fireEvent.change(screen.getByLabelText('あらすじ'), { target: { value: ' 物語の概要 ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: '新題',
      author: '山田太郎',
      description: '物語の概要',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('タイトルが空のときは保存できない', () => {
    render(
      <WorkMetaDialog
        open
        onOpenChange={() => {}}
        initial={{ title: '', author: '', description: '' }}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})
