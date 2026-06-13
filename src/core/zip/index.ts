/**
 * 最小の ZIP 書き出し（store 方式＝無圧縮）。依存ゼロ・所有。
 * EPUB 梱包に使う（mimetype を先頭・無圧縮で置けばよく、deflate は不要）。
 */

export interface ZipInput {
  path: string
  data: string | Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!)! & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
const toBytes = (d: string | Uint8Array): Uint8Array => (typeof d === 'string' ? enc.encode(d) : d)

interface Local {
  nameBytes: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

export function zipStore(inputs: ZipInput[]): Uint8Array {
  const locals: Local[] = []
  const chunks: Uint8Array[] = []
  let offset = 0

  for (const input of inputs) {
    const nameBytes = enc.encode(input.path)
    const data = toBytes(input.data)
    const crc = crc32(data)
    const header = new Uint8Array(30 + nameBytes.length)
    const v = new DataView(header.buffer)
    v.setUint32(0, 0x04034b50, true) // local file header signature
    v.setUint16(4, 20, true) // version needed
    v.setUint16(6, 0, true) // flags
    v.setUint16(8, 0, true) // method = store
    v.setUint16(10, 0, true) // mod time
    v.setUint16(12, 0x21, true) // mod date (1980-01-01)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true) // compressed size
    v.setUint32(22, data.length, true) // uncompressed size
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, 0, true) // extra length
    header.set(nameBytes, 30)

    locals.push({ nameBytes, data, crc, offset })
    chunks.push(header, data)
    offset += header.length + data.length
  }

  const cdStart = offset
  for (const l of locals) {
    const rec = new Uint8Array(46 + l.nameBytes.length)
    const v = new DataView(rec.buffer)
    v.setUint32(0, 0x02014b50, true) // central dir header signature
    v.setUint16(4, 20, true) // version made by
    v.setUint16(6, 20, true) // version needed
    v.setUint16(8, 0, true) // flags
    v.setUint16(10, 0, true) // method
    v.setUint16(12, 0, true) // mod time
    v.setUint16(14, 0x21, true) // mod date
    v.setUint32(16, l.crc, true)
    v.setUint32(20, l.data.length, true)
    v.setUint32(24, l.data.length, true)
    v.setUint16(28, l.nameBytes.length, true)
    v.setUint16(30, 0, true) // extra
    v.setUint16(32, 0, true) // comment
    v.setUint16(34, 0, true) // disk number
    v.setUint16(36, 0, true) // internal attrs
    v.setUint32(38, 0, true) // external attrs
    v.setUint32(42, l.offset, true) // local header offset
    rec.set(l.nameBytes, 46)
    chunks.push(rec)
    offset += rec.length
  }
  const cdSize = offset - cdStart

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // EOCD signature
  ev.setUint16(8, locals.length, true) // entries on this disk
  ev.setUint16(10, locals.length, true) // total entries
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, cdStart, true)
  chunks.push(eocd)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}
