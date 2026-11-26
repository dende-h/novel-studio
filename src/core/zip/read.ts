import { crc32 } from '.'

const maxEntries = 2000

export function validArchivePath(path: string): boolean {
  return (
    !/[\\:]/.test(path) &&
    !Array.from(path).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    path
      .replace(/\/$/, '')
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

async function inflate(data: Uint8Array, expected: number) {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const out = new Uint8Array(expected)
  let offset = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out.subarray(0, offset)
      if (value.length + offset > expected) throw new Error('展開サイズが記録と一致しません')
      out.set(value, offset)
      offset += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function readArchive(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<Map<string, Uint8Array>> {
  if (bytes.length > maxBytes) throw new Error('ファイルは20 MBまで取り込めます')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (i: number) => view.getUint16(i, true)
  const u32 = (i: number) => view.getUint32(i, true)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 22 - 65535); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break
  }
  if (end < Math.max(0, bytes.length - 22 - 65535)) throw new Error('ZIPの終端が見つかりません')
  const count = u16(end + 10)
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) {
    throw new Error('分割されたZIPは取り込めません')
  }
  if (count > maxEntries) throw new Error('ZIPに含められるファイルは2,000件までです')
  let cursor = u32(end + 16)
  const directory = cursor
  if (cursor + u32(end + 12) !== end) throw new Error('ZIPの目録が壊れています')
  const seen = new Set<string>()
  let total = 0
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const members = []
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw new Error('ZIPの目録が壊れています')
    const flags = u16(cursor + 8)
    const method = u16(cursor + 10)
    const checksum = u32(cursor + 16)
    const compressed = u32(cursor + 20)
    const size = u32(cursor + 24)
    const nameSize = u16(cursor + 28)
    const local = u32(cursor + 42)
    if (flags & 0x2041) throw new Error('暗号化されたZIPは取り込めません')
    if (method !== 0 && method !== 8) throw new Error('ZIPの圧縮方式に対応していません')
    const next = cursor + 46 + nameSize + u16(cursor + 30) + u16(cursor + 32)
    if (next > end || u16(cursor + 34)) throw new Error('ZIPの目録が壊れています')
    total += size
    if (total > maxBytes) throw new Error('ZIPは展開後20 MBまで取り込めます')
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameSize)
    let path: string
    try {
      path = utf8.decode(name)
    } catch {
      if (flags & 0x800) throw new Error('ZIPのファイル名をUTF-8で読めません')
      path = new TextDecoder('shift_jis', { fatal: true }).decode(name)
    }
    if (!validArchivePath(path)) throw new Error(`ZIPに無効な相対パスがあります（${path}）`)
    const key = path.replace(/\/$/, '').normalize('NFC')
    if (seen.has(key)) throw new Error(`ZIPに同じパスがあります（${path}）`)
    seen.add(key)
    if (/\.(?:zip|epub|jar|7z|rar|tar|gz)$/i.test(path))
      throw new Error(`ZIP内の圧縮ファイルは取り込めません（${path}）`)
    if (
      local + 30 > directory ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameSize ||
      !name.every((byte, index) => bytes[local + 30 + index] === byte)
    ) {
      throw new Error(`ZIP内のファイル情報が壊れています（${path}）`)
    }
    if (
      !(flags & 8) &&
      (u32(local + 14) !== checksum || u32(local + 18) !== compressed || u32(local + 22) !== size)
    ) {
      throw new Error(`ZIP内のファイルサイズが一致しません（${path}）`)
    }
    const start = local + 30 + nameSize + u16(local + 28)
    if (start + compressed > directory || (method === 0 && compressed !== size))
      throw new Error(`ZIP内のファイルが途中で切れています（${path}）`)
    members.push({ path, local, start, compressed, size, checksum, method })
    cursor = next
  }
  if (cursor !== end) throw new Error('ZIPの目録の長さが一致しません')
  const ordered = [...members].sort((a, b) => a.local - b.local)
  if (
    ordered.some(
      (member, i) => member.start + member.compressed > (ordered[i + 1]?.local ?? directory),
    )
  ) {
    throw new Error('ZIP内のファイル範囲が重なっています')
  }
  const result = new Map<string, Uint8Array>()
  for (const member of members) {
    const { path, start, compressed, size, checksum, method } = member
    try {
      const raw = bytes.subarray(start, start + compressed)
      const data = method === 0 ? raw.slice() : await inflate(raw, size)
      if (data.length !== size || crc32(data) !== checksum)
        throw new Error('チェックサムが一致しません')
      if (!path.endsWith('/')) result.set(path, data)
    } catch (error) {
      throw new Error(`ZIP内の「${path}」を展開できません`, { cause: error })
    }
  }
  return result
}
