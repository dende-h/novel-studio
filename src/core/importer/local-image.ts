import { illustrationFileTag } from '../sites/illustrations'
import { crc32 } from '../zip'
import type { ManuscriptAsset } from './site-formats'

export function linkedImage(
  path: string,
  data: Uint8Array | undefined,
  assets: Map<string, ManuscriptAsset>,
) {
  if (!data || !/\.(?:png|jpe?g|gif|webp)$/i.test(path)) return illustrationFileTag(path)
  const tag = String.fromCharCode(...data.subarray(0, 12))
  const png = data[0] === 0x89 && tag.slice(1, 4) === 'PNG' && data[6] === 26
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (!png && !jpeg && !/^GIF8[79]a|^RIFF....WEBP/s.test(tag)) return illustrationFileTag(path)
  const key = `${crc32(data).toString(16)}-${data.length}`
  const assetPath = `${key}/${path}`
  assets.set(assetPath, { path: assetPath, data })
  return illustrationFileTag(path, key)
}
