/// <reference types="@cloudflare/workers-types" />
/**
 * 同期ブロブの at-rest 暗号化（Phase 2・サーバ側）。
 *
 * 平文 part（canonicalize 済み JSON）を gzip → AES-GCM で暗号化し、
 * `[12B IV][ciphertext+tag]` の 1 つの Uint8Array にして R2 に置く。
 * 鍵は base64 の 32byte（Workers Secret `ENCRYPTION_KEY`）。AAD で part を識別子に縛る
 * （userId:workId:doc/media）。E2E 暗号化ではない（鍵はサーバ管理）。
 */

const IV_BYTES = 12

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

/** base64 の 32byte 鍵を AES-GCM の CryptoKey に取り込む。 */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key)
  if (raw.byteLength !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** 文字列を gzip で圧縮して返す。 */
export async function gzip(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** gzip の逆。 */
export async function gunzip(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

/** 平文を gzip → AES-GCM 暗号化し、`[IV][ciphertext+tag]` を返す。 */
export async function encryptPart(
  plaintext: string,
  key: CryptoKey,
  aad: string,
): Promise<Uint8Array> {
  const compressed = await gzip(plaintext)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const additionalData = new TextEncoder().encode(aad)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, compressed)
  const out = new Uint8Array(IV_BYTES + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), IV_BYTES)
  return out
}

/** encryptPart の逆。IV を切り出して復号 → gunzip。 */
export async function decryptPart(blob: Uint8Array, key: CryptoKey, aad: string): Promise<string> {
  const iv = blob.subarray(0, IV_BYTES)
  const ct = blob.subarray(IV_BYTES)
  const additionalData = new TextEncoder().encode(aad)
  const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, ct)
  return gunzip(new Uint8Array(compressed))
}

/** SHA-256 の hex。canonicalize 済み文字列に対して使う（ハッシュ一致判定）。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
