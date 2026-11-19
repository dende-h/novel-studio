import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { FeatureIntro } from './feature-intro'

beforeEach(() => {
  localStorage.removeItem('ns-feature-intro-glossary')
  localStorage.removeItem('ns-feature-intro-plot')
})

it('初回だけ自動で開き、閉じた後もはじめ方から読み返せる', () => {
  const view = render(<FeatureIntro feature="glossary" />)
  const intro = () => screen.getByText(/登場人物を一人追加します/)
  expect(intro()).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '用語集の案内を閉じる' }))
  expect(intro()).not.toBeVisible()
  expect(screen.getByRole('button', { name: '用語集のはじめ方' })).toHaveFocus()
  view.unmount()

  render(<FeatureIntro feature="glossary" />)
  expect(intro()).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '用語集のはじめ方' }))
  expect(intro()).toBeVisible()
})

it('ページごとに初回表示を管理し、初期画面に合う最初の手順を表示する', () => {
  localStorage.setItem('ns-feature-intro-glossary', '1')
  render(<FeatureIntro feature="plot" firstStep="使いたい型を一つ選びます。" />)
  expect(screen.getByText(/使いたい型を一つ選びます/)).toBeVisible()
  expect(screen.queryByText(/「ビートを追加」/)).toBeNull()
})
