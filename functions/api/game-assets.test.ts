// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isValidAssetId } from './game-assets'

/** R2 キー（`${userId}/gameassets/${id}`）に入る id の形。パス区切りや空を通さない。 */
describe('isValidAssetId', () => {
  it('crypto.randomUUID の形式を通す', () => {
    expect(isValidAssetId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true)
  })

  it('パス区切り・空・長すぎる id を弾く', () => {
    expect(isValidAssetId('')).toBe(false)
    expect(isValidAssetId('../../../etc')).toBe(false)
    expect(isValidAssetId('a/b')).toBe(false)
    expect(isValidAssetId('a'.repeat(65))).toBe(false)
  })
})
