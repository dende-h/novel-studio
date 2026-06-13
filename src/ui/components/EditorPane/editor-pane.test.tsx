import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorPane } from './editor-pane'

describe('EditorPane（Presentational）', () => {
  it('value を textarea に表示', () => {
    render(<EditorPane value="本文テスト" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('本文テスト')
  })

  it('入力で onChange に新しい値を渡す', () => {
    const onChange = vi.fn()
    render(<EditorPane value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: '本文' }), { target: { value: 'あ' } })
    expect(onChange).toHaveBeenCalledWith('あ')
  })
})
