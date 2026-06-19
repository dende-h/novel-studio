import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ZoomableImage } from './zoomable-image'

const SRC = 'data:image/jpeg;base64,SGk='

describe('ZoomableImage（クリックで拡大表示）', () => {
  it('トリガは「○○を拡大表示」のボタンで、初期は拡大画像を出さない', () => {
    render(<ZoomableImage src={SRC} alt="アリス" className="size-12" />)
    expect(screen.getByRole('button', { name: 'アリスを拡大表示' })).toBeInTheDocument()
    // 拡大画像（alt 付き）はまだ出ていない。トリガ内のサムネは装飾（alt=""）。
    expect(screen.queryByAltText('アリス')).toBeNull()
  })

  it('クリックで拡大画像（同じ src・alt 付き）がダイアログに出る', () => {
    render(<ZoomableImage src={SRC} alt="アリス" className="size-12" />)
    fireEvent.click(screen.getByRole('button', { name: 'アリスを拡大表示' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const enlarged = screen.getByAltText('アリス')
    expect(enlarged).toBeInTheDocument()
    expect(enlarged).toHaveAttribute('src', SRC)
  })

  it('閉じるボタンで拡大表示を閉じる', async () => {
    render(<ZoomableImage src={SRC} alt="表紙" className="h-24" />)
    fireEvent.click(screen.getByRole('button', { name: '表紙を拡大表示' }))
    expect(screen.getByAltText('表紙')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拡大表示を閉じる' }))
    await waitFor(() => expect(screen.queryByAltText('表紙')).toBeNull())
  })

  it('Escape で拡大表示を閉じる', async () => {
    render(<ZoomableImage src={SRC} alt="表紙" className="h-24" />)
    fireEvent.click(screen.getByRole('button', { name: '表紙を拡大表示' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
