import { describe, expect, it } from 'vitest'
import { selectNarrationSentence as select } from './selection'

const order = ['a', 'b', 'c', 'd', 'e', 'f']
describe('朗読の連続した文の選択', () => {
  it('下から上へ広げた後にさらに下を選んでも、上側が消えない', () => {
    const initial = select(order, [], 'd')
    const upwards = select(order, initial, 'b')
    expect(upwards).toEqual(['b', 'c', 'd'])
    expect(select(order, upwards, 'f')).toEqual(['b', 'c', 'd', 'e', 'f'])
  })
  it('中間を押すとその文以降を解除する', () => {
    expect(select(order, ['a', 'b', 'c', 'd'], 'c')).toEqual(['a', 'b'])
  })
  it('先頭・末尾・単一文の解除は隣の選択を維持する', () => {
    expect(select(order, ['b', 'c', 'd'], 'b')).toEqual(['c', 'd'])
    expect(select(order, ['b', 'c', 'd'], 'd')).toEqual(['b', 'c'])
    expect(select(order, ['b'], 'b')).toEqual([])
  })
  it('修正位置への移動は単一文を選び、旧い飛び飛びの選択も次の操作で連続になる', () => {
    expect(select(order, ['b', 'c', 'd'], 'f', true)).toEqual(['f'])
    expect(select(order, ['a', 'c'], 'e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
