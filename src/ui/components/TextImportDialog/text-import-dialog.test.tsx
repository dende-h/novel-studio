import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as importer from '@/core/importer'
import type { Work } from '@/core/schema'
import { TextImportDialog } from './text-import-dialog'

let n = 0
const genId = () => `id-${++n}`

const renderDialog = (over: Partial<React.ComponentProps<typeof TextImportDialog>> = {}) => {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onWrite = vi.fn()
  render(
    <TextImportDialog
      open
      onOpenChange={() => {}}
      onCreate={onCreate}
      onWrite={onWrite}
      genId={genId}
      now={() => 1}
      {...over}
    />,
  )
  return { onCreate, onWrite }
}

const switchToPaste = () => fireEvent.click(screen.getByRole('button', { name: '貼り付け' }))

const pasteText = (text: string) => {
  switchToPaste()
  fireEvent.change(screen.getByLabelText('本文'), { target: { value: text } })
}

const pickFiles = (files: File[]) => {
  const input = screen.getByLabelText('テキストファイル') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const txt = (name: string, text: string) => new File([text], name, { type: 'text/plain' })

describe('TextImportDialog', () => {
  it('何も読み込んでいないと案内が出て「作品を作る」は押せない', () => {
    renderDialog()
    expect(screen.getByText('テキストを読み込むと、ここに話の分かれ方が出ます')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作品を作る' })).toBeDisabled()
  })

  it('貼り付け → 見出しで 2 話に分かれ → タイトルを直して作成 → 完了 → 執筆を始める', async () => {
    vi.useFakeTimers()
    const { onCreate, onWrite } = renderDialog({ defaultAuthor: 'ペン' })
    pasteText('第1話　出会い\n本文A\n\n第2話\n本文B')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    vi.useRealTimers()

    expect(await screen.findByText('2 話に分かれます')).toBeInTheDocument()
    expect(screen.getByLabelText('作品タイトル')).toHaveValue('取り込んだ作品')
    expect(screen.getByLabelText('著者')).toHaveValue('ペン')

    fireEvent.change(screen.getByLabelText('2話目のタイトル'), { target: { value: '第2話　別れ' } })
    fireEvent.change(screen.getByLabelText('作品タイトル'), { target: { value: '雨の町' } })
    fireEvent.click(screen.getByRole('button', { name: '作品を作る' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    const work = onCreate.mock.calls[0]?.[0] as Work
    expect(work.title).toBe('雨の町')
    expect(work.author).toBe('ペン')
    expect(work.format).toBeUndefined()
    expect(work.episodes.map((e) => e.title)).toEqual(['第1話　出会い', '第2話　別れ'])
    expect(work.episodes[0]?.blocks[0]?.inlines[0]).toEqual({ type: 'text', text: '本文A' })

    expect(await screen.findByText(/2 話で「雨の町」を作りました/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '執筆を始める' }))
    expect(onWrite).toHaveBeenCalledWith(work.id)
  })

  it('貼り付けでは「ファイルごとに1話」が選べない', () => {
    renderDialog()
    switchToPaste()
    expect(screen.getByLabelText('ファイルごとに1話')).toBeDisabled()
  })

  it('.txt 以外は弾かれ、同名ファイルは追加されない', async () => {
    renderDialog()
    pickFiles([txt('memo.md', '本文')])
    expect(await screen.findByText('.txt のテキストファイルを選んでください')).toBeInTheDocument()

    pickFiles([txt('a.txt', '第1話\nA')])
    expect(await screen.findByText('1 話に分かれます')).toBeInTheDocument()
    pickFiles([txt('a.txt', '第1話\nB')])
    expect(await screen.findByText('同じ名前のファイルはすでにあります')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '読み込んだファイル' })
    expect(within(list).getAllByText('a.txt')).toHaveLength(1)
  })

  it('複数ファイルは自然順に並び、作品タイトルの既定は先頭ファイル名', async () => {
    renderDialog()
    pickFiles([txt('10.txt', '第3話\nC'), txt('2.txt', '第1話\nA\n第2話\nB')])
    expect(await screen.findByText('3 話に分かれます')).toBeInTheDocument()
    expect(screen.getByLabelText('作品タイトル')).toHaveValue('2')
    expect(screen.getByLabelText('1話目のタイトル')).toHaveValue('第1話')
    expect(screen.getByLabelText('3話目のタイトル')).toHaveValue('第3話')
  })

  it('読めないファイルはその行だけエラーになり、他のファイルは残る', async () => {
    renderDialog()
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'cover.txt',
    )
    pickFiles([txt('a.txt', '本文'), png])
    expect(
      await screen.findByText(/「cover.txt」は読み込めませんでした。UTF-8 か Shift_JIS/),
    ).toBeInTheDocument()
    expect(await screen.findByText('1 話に分かれます')).toBeInTheDocument()
  })

  it('見出しの無い本文は 1 話にまとめ、案内が出る', async () => {
    renderDialog()
    pickFiles([txt('a.txt', 'ただの本文')])
    expect(
      await screen.findByText('見出しが見つからなかったので、1話にまとめました'),
    ).toBeInTheDocument()
  })

  it('「前の話とつなげる」で話数が減る', async () => {
    renderDialog()
    pickFiles([txt('a.txt', '第1話\nA\n第2話\nB')])
    expect(await screen.findByText('2 話に分かれます')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '前の話とつなげる' }))
    expect(await screen.findByText('1 話に分かれます')).toBeInTheDocument()
  })

  it('作成した Work の JSON が上限を超えると保存せずエラーを出す', async () => {
    const spy = vi
      .spyOn(importer, 'workJsonBytes')
      .mockReturnValue(importer.MAX_WORK_JSON_BYTES + 1)
    const { onCreate } = renderDialog()
    pickFiles([txt('a.txt', '第1話\nA')])
    expect(await screen.findByText('1 話に分かれます')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '作品を作る' }))
    expect(
      await screen.findByText('本文が大きすぎます。ファイルを分けて取り込んでください'),
    ).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
