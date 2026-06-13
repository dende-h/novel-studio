import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LandingPage } from './landing-page'

describe('LandingPage（入り口・Presentational）', () => {
  it('ブランド見出しと主CTAを表示し、CTAで onStart', () => {
    const onStart = vi.fn()
    render(<LandingPage onStart={onStart} hasWorks={false} />)
    expect(screen.getByRole('heading', { level: 1, name: 'novel-studio' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '書き始める' }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('既存作品があれば再開ラベルになる', () => {
    render(<LandingPage onStart={() => {}} hasWorks />)
    expect(screen.getByRole('button', { name: '執筆を再開' })).toBeInTheDocument()
  })

  it('主要な価値を訴求（ローカル保存・EPUB・各サイト記法）', () => {
    render(<LandingPage onStart={() => {}} hasWorks={false} />)
    expect(screen.getAllByText(/オフライン/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/EPUB/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/なろう/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/カクヨム/).length).toBeGreaterThan(0)
  })

  it('末尾CTAも onStart を呼ぶ', () => {
    const onStart = vi.fn()
    render(<LandingPage onStart={onStart} hasWorks={false} />)
    fireEvent.click(screen.getByRole('button', { name: '今すぐはじめる' }))
    expect(onStart).toHaveBeenCalledOnce()
  })
})
