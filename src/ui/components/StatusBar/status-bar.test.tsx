import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBar } from './status-bar'

describe('StatusBar（Presentational）', () => {
  it('dirty=true は未保存を示す', () => {
    render(<StatusBar dirty status="idle" />)
    expect(screen.getByText(/未保存/)).toBeInTheDocument()
  })

  it('saving は保存中を示す', () => {
    render(<StatusBar dirty={false} status="saving" />)
    expect(screen.getByText(/保存中/)).toBeInTheDocument()
  })

  it('saved かつ clean は保存済みを示す', () => {
    render(<StatusBar dirty={false} status="saved" />)
    expect(screen.getByText(/保存済/)).toBeInTheDocument()
  })
})
