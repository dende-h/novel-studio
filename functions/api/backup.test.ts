// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { rejectsLiveOverwrite } from './backup'

/**
 * ライブスナップショットの上書き保護。AI が書いた未取り込みの編集を、
 * ブラウザの自動 push（編集のたびに走る）が黙って消さないための判定。
 */
describe('rejectsLiveOverwrite', () => {
  it('未取り込みの AI 編集があれば拒否し、その時刻を返す', () => {
    expect(rejectsLiveOverwrite('1750000000000', false)).toBe(1750000000000)
  })

  it('目印が無ければ通す（通常の自動 push）', () => {
    expect(rejectsLiveOverwrite(undefined, false)).toBeNull()
  })

  it('force のときは目印があっても通す（取り込み直後のリセット）', () => {
    expect(rejectsLiveOverwrite('1750000000000', true)).toBeNull()
  })

  it('壊れた目印は通す（保護のために push を永久停止させない）', () => {
    expect(rejectsLiveOverwrite('not-a-number', false)).toBeNull()
  })
})
