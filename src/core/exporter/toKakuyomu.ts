import type { Block } from '../schema'
import { toPostingSite } from './toPostingSite'

export function blocksToKakuyomu(blocks: Block[]): string {
  return toPostingSite(blocks, 'kakuyomu').text
}

export default blocksToKakuyomu
