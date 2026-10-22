/**
 * zip の展開（COT-40・辞書の zip 用）。依存を足さずに自前で持つ。
 * 中央ディレクトリを読み、stored（0）と deflate（8）だけを扱う。展開は DecompressionStream('deflate-raw')。
 * 名前はディレクトリを除いたファイル名で返す（lindera-ipadic/dict.trie → dict.trie）。
 */
const u16 = (b: Uint8Array, p: number) => (b[p] as number) | ((b[p + 1] as number) << 8)
const u32 = (b: Uint8Array, p: number) => (u16(b, p) | (u16(b, p + 2) << 16)) >>> 0

function findEndOfCentralDirectory(b: Uint8Array): number {
  for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 0xffff); p--) {
    if (b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 0x05 && b[p + 3] === 0x06) return p
  }
  throw new Error('zip の終端が見つかりません')
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function unzipEntries(
  zip: Uint8Array,
  wanted?: ReadonlySet<string>,
): Promise<Map<string, Uint8Array>> {
  const eocd = findEndOfCentralDirectory(zip)
  const count = u16(zip, eocd + 10)
  let p = u32(zip, eocd + 16)
  const decoder = new TextDecoder()
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    const method = u16(zip, p + 10)
    const size = u32(zip, p + 20)
    const nameLen = u16(zip, p + 28)
    const extraLen = u16(zip, p + 30)
    const commentLen = u16(zip, p + 32)
    const local = u32(zip, p + 42)
    const fullName = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    const name = fullName.slice(fullName.lastIndexOf('/') + 1)
    if (!name || (wanted && !wanted.has(name))) continue
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28)
    const data = zip.subarray(start, start + size)
    if (method === 0) out.set(name, data.slice())
    else if (method === 8) out.set(name, await inflateRaw(data))
    else throw new Error(`zip の圧縮方式 ${method} には対応していません`)
  }
  return out
}
