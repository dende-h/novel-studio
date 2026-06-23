import { describe, expect, it } from 'vitest'
import { r2Key } from './r2keys'

describe('r2Key', () => {
  it('<userId>/<workId>/<part> を組み立てる', () => {
    expect(r2Key('user_1', 'w1', 'doc')).toBe('user_1/w1/doc')
    expect(r2Key('user_1', 'w1', 'media')).toBe('user_1/w1/media')
  })
})
