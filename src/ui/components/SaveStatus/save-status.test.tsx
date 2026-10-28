import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { SaveStatus } from './save-status'

it('最新draftと保存中の状態を区別し、集中表示では文字を狭幅でも隠さない', () => {
  const { rerender } = render(<SaveStatus dirty={false} status="idle" alwaysLabel />)
  expect(screen.getByRole('status')).toHaveTextContent('ローカル保存')
  rerender(<SaveStatus dirty status="idle" alwaysLabel />)
  expect(screen.getByRole('status')).toHaveTextContent('未保存')
  rerender(<SaveStatus dirty status="saving" alwaysLabel />)
  expect(screen.getByRole('status')).toHaveTextContent('保存中…')
  rerender(<SaveStatus dirty status="saved" alwaysLabel />)
  expect(screen.getByRole('status')).toHaveTextContent('未保存')
  rerender(<SaveStatus dirty={false} status="saved" alwaysLabel />)
  expect(screen.getByRole('status')).toHaveTextContent('保存済み')
  expect(screen.getByText('保存済み')).not.toHaveClass('max-sm:sr-only')
})
