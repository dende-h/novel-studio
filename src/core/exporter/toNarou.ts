import type { Block } from '../schema'
import { toPostingSite } from './toPostingSite'

export function blocksToNarou(blocks: Block[]): string {
  return toPostingSite(blocks, 'narou').text
}

export default blocksToNarou
