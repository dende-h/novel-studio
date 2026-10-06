import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkSearchPanel } from './work-search-panel'

const sources: [
  import('@/core/search/workSearch').SearchSource,
  import('@/core/search/workSearch').SearchSource,
] = [
  { episodeId: 'one', title: '第一話', text: '猫と猫' },
  { episodeId: 'two', title: '第二話', text: '猫' },
]
const setup = (textSources: import('@/core/search/workSearch').SearchSource[] = sources) => {
  const onReplace = vi.fn().mockResolvedValue(undefined)
  const onNavigate = vi.fn().mockResolvedValue(undefined)
  const onApply = vi.fn()
  const props = {
    sources: textSources,
    value: '猫と猫',
    busy: false,
    onApply,
    onReplace,
    onNavigate,
    onClose: vi.fn(),
  }
  const view = render(<WorkSearchPanel {...props} />)
  return { ...view, props, onReplace, onNavigate, onApply }
}
const search = async () => {
  fireEvent.click(screen.getByRole('button', { name: '作品全体' }))
  fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
  fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '犬' } })
  await screen.findByText('3件・2話')
}

describe('WorkSearchPanel', () => {
  it('この話は従来どおり下書きへ即時適用する', () => {
    const { onApply } = setup()
    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
    fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '$&' } })
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))
    expect(onApply).toHaveBeenCalledWith('$&と$&', 2)
  })
  it('全話結果から移動と1件置換をそれぞれ操作する', async () => {
    const { onReplace, onNavigate } = setup()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /第二話・1行/ }))
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        sources,
        '猫',
        expect.objectContaining({ episodeId: 'two', start: 0 }),
      ),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'この1件を置換' })[1] as HTMLElement)
    await waitFor(() =>
      expect(onReplace).toHaveBeenCalledWith(
        sources,
        '猫',
        '犬',
        expect.objectContaining({ episodeId: 'one', start: 2 }),
      ),
    )
  })
  it('全置換は確認し、キャンセルでは何も保存しない', async () => {
    const { onReplace } = setup()
    await search()
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))
    expect(screen.getByText('3件を置換しますか？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onReplace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))
    fireEvent.click(screen.getByRole('button', { name: /^置換$/ }))
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(sources, '猫', '犬', 'all'))
  })
  it('検索元更新後のdebounce中は古い結果を操作できない', async () => {
    const { rerender, props } = setup()
    await search()
    rerender(<WorkSearchPanel {...props} sources={[{ ...sources[0], text: '犬' }]} />)
    expect(screen.getByRole('button', { name: 'すべて置換' })).toBeDisabled()
    expect(
      screen.getAllByRole('button', { name: 'この1件を置換' })[0] as HTMLElement,
    ).toBeDisabled()
    await screen.findByText('見つかりませんでした')
  })
  it('IME中は検索せず確定後に件数を表示する', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '作品全体' }))
    const input = screen.getByLabelText('検索する語')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '猫' } })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
    })
    expect(screen.queryByText('3件・2話')).not.toBeInTheDocument()
    fireEvent.compositionEnd(input)
    await screen.findByText('3件・2話')
  })
  it('100件ずつ表示し件数と全件置換は全結果を対象にする', async () => {
    setup([{ ...sources[0], text: '猫'.repeat(201) }])
    fireEvent.click(screen.getByRole('button', { name: '作品全体' }))
    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
    await screen.findByText('201件・1話')
    expect(screen.getAllByRole('button', { name: 'この1件を置換' })).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: 'さらに表示' }))
    expect(screen.getAllByRole('button', { name: 'この1件を置換' })).toHaveLength(200)
  })
  it('保存失敗を表示し同じ語と処理中の置換を止める', async () => {
    const { onReplace, props, rerender } = setup()
    onReplace.mockRejectedValue(new Error('本文は変更していません。もう一度お試しください'))
    await search()
    fireEvent.click(screen.getAllByRole('button', { name: 'この1件を置換' })[0] as HTMLElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('本文は変更していません')
    fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '猫' } })
    expect(screen.getByRole('button', { name: 'すべて置換' })).toBeDisabled()
    rerender(<WorkSearchPanel {...props} busy />)
    expect(screen.getByRole('button', { name: 'すべて置換' })).toBeDisabled()
  })
  it('参照は検索・移動でき、1件置換と全置換の件数から除外する', async () => {
    const { onNavigate, onReplace } = setup([
      { episodeId: 'one', title: '第一話', text: '猫 [[猫]]' },
      { episodeId: 'two', title: '第二話', text: '[[猫]]' },
    ])
    await search()
    expect(screen.getAllByText('用語集の参照・置換対象外')).toHaveLength(2)
    expect(screen.getByText('1件を置換できます')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'この1件を置換' })
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
    expect(buttons[2]).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /第二話・1行/ }))
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        expect.any(Array),
        '猫',
        expect.objectContaining({ isReference: true }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))
    expect(screen.getByText('1件を置換しますか？')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('1話の本文を変更します')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onReplace).not.toHaveBeenCalled()
  })
  it('参照だけならすべて置換できず、この話でも括弧を変更しない', async () => {
    const { props, rerender, onApply } = setup([
      { episodeId: 'one', title: '第一話', text: '[[猫]]' },
    ])
    fireEvent.click(screen.getByRole('button', { name: '作品全体' }))
    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
    fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '犬' } })
    await screen.findByText('0件を置換できます')
    expect(screen.getByRole('button', { name: 'すべて置換' })).toBeDisabled()
    rerender(<WorkSearchPanel {...props} value="[猫] [[猫]]" />)
    fireEvent.click(screen.getByRole('button', { name: 'この話' }))
    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '[' } })
    fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '' } })
    expect(screen.getByText('1件を置換できます')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))
    expect(onApply).toHaveBeenCalledWith('猫] [[猫]]', 1)
  })
})
