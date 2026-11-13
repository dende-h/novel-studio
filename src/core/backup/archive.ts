import { crc32, type ZipInput, zipStore } from '../zip'
import { deserializeBackup } from './index'

/** Only our uncompressed, bounded archive format is accepted. No path extraction or inflation. */
export function readBackupArchive(bytes: Uint8Array): {
  json: string
  audio: Map<string, Uint8Array>
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, Uint8Array>()
  let pos = 0
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const flags = view.getUint16(pos + 6, true)
    const method = view.getUint16(pos + 8, true)
    const crc = view.getUint32(pos + 14, true)
    const size = view.getUint32(pos + 18, true)
    const original = view.getUint32(pos + 22, true)
    const nameLength = view.getUint16(pos + 26, true)
    const extraLength = view.getUint16(pos + 28, true)
    const start = pos + 30 + nameLength + extraLength
    if (flags !== 0 || method !== 0 || original !== size || start + size > bytes.length)
      throw new Error('バックアップの形式を確認できませんでした。')
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLength))
    if (name !== 'backup.json' && !/^[a-f0-9]{64}\.mp3$/.test(name))
      throw new Error('バックアップに未知のファイルがあります。')
    if (files.has(name)) throw new Error('バックアップのファイルが重複しています。')
    const data = bytes.subarray(start, start + size)
    if (crc32(data) !== crc) throw new Error('バックアップが破損しています。')
    files.set(name, data)
    pos = start + size
  }
  if (
    pos + 4 > bytes.length ||
    view.getUint32(pos, true) !== 0x02014b50 ||
    !files.has('backup.json')
  )
    throw new Error('バックアップの形式を確認できませんでした。')
  const end = bytes.length - 22
  if (
    end < pos ||
    view.getUint32(end, true) !== 0x06054b50 ||
    view.getUint16(end + 10, true) !== files.size ||
    view.getUint32(end + 16, true) !== pos ||
    view.getUint32(end + 12, true) + pos !== end
  )
    throw new Error('バックアップの終端が破損しています。')
  const json = new TextDecoder().decode(files.get('backup.json'))
  const backup = deserializeBackup(json)
  for (const entry of backup.narrations ?? [])
    for (const hash of Object.values(entry.audio))
      if (!files.has(hash + '.mp3')) throw new Error('バックアップに必要な音声が含まれていません。')
  files.delete('backup.json')
  return { json, audio: files }
}
export function createBackupArchive(json: string, audio: Map<string, Uint8Array>): Uint8Array {
  const inputs: ZipInput[] = [{ path: 'backup.json', data: json }]
  for (const [hash, bytes] of audio) inputs.push({ path: hash + '.mp3', data: bytes })
  if (inputs.length > 65535 || inputs.reduce((n, f) => n + f.data.length + 512, 0) >= 0xffff_ffff)
    throw new Error('バックアップがZIPの上限を超えています。クラウドバックアップをご利用ください。')
  return zipStore(inputs)
}
