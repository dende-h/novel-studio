/**
 * X API の最小クライアント（動画を上げて投稿するだけ）。依存を足さず fetch と node:crypto で書く。
 *
 * 認証は OAuth 1.0a（User Context）。4 つの値は期限が無いので、ルーティンの環境変数に
 * 置いたまま毎日使える（OAuth 2.0 はリフレッシュトークンが使うたびに替わり、保存し直す先が要る）。
 *
 * 動画は v2 のチャンク方式（initialize → append → finalize → 状態確認）で上げる。
 * v2 のアップロードが OAuth 1.0a を拒んだ報告（2025 年）があるため、401/403 のときは
 * v1.1（upload.x.com）へ切り替える。どちらで通ったかは結果に残す。
 *
 * 料金（2026-09 時点・従量課金）：投稿 $0.015／URL を含む投稿 $0.20。
 */
import { createHmac, randomBytes } from 'node:crypto'

export interface XCredentials {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

const API = 'https://api.x.com'
const UPLOAD_V1 = 'https://upload.x.com/1.1/media/upload.json'
const CHUNK = 4 * 1024 * 1024

/** i 番目のチャンク（4MB）を Blob にする。Uint8Array に写して ArrayBuffer 裏付けにする。 */
const chunkBlob = (video: Buffer, i: number) =>
  new Blob([new Uint8Array(video.subarray(i * CHUNK, (i + 1) * CHUNK))])

/** RFC 3986 のパーセントエンコード（OAuth 1.0a が要求する形）。 */
export const pct = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * OAuth 1.0a の Authorization ヘッダを作る。
 * 署名に含めるのはクエリと application/x-www-form-urlencoded の本文だけ（JSON・multipart は含めない）。
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  formParams: Record<string, string> = {},
  fixed?: { nonce: string; timestamp: string },
): string {
  const u = new URL(url)
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: fixed?.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }
  const pairs: [string, string][] = [
    ...Object.entries(oauth),
    ...Object.entries(formParams),
    ...[...u.searchParams.entries()],
  ].map(([k, v]) => [pct(k), pct(v)])
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`
  const base = [method.toUpperCase(), pct(baseUrl), pct(paramString)].join('&')
  const key = `${pct(creds.apiSecret)}&${pct(creds.accessTokenSecret)}`
  const signature = createHmac('sha1', key).update(base).digest('base64')
  const header = { ...oauth, oauth_signature: signature }
  return `OAuth ${Object.entries(header)
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(', ')}`
}

// node の型除去（type stripping）でそのまま動かすため、引数プロパティ等の TS 固有構文は使わない。
export class XApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string, where: string) {
    super(`X API ${where} が ${status} を返した: ${body.slice(0, 500)}`)
    this.status = status
    this.body = body
  }
}

type Json = Record<string, unknown>

export class XClient {
  private readonly creds: XCredentials
  constructor(creds: XCredentials) {
    this.creds = creds
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    where: string,
    body?: { json?: Json; form?: Record<string, string>; multipart?: FormData },
  ): Promise<Json> {
    const headers: Record<string, string> = {
      Authorization: oauthHeader(method, url, this.creds, body?.form),
    }
    let payload: string | FormData | undefined
    if (body?.json) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body.json)
    } else if (body?.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      payload = new URLSearchParams(body.form).toString()
    } else if (body?.multipart) {
      payload = body.multipart
    }
    const res = await fetch(url, { method, headers, body: payload })
    const text = await res.text()
    if (!res.ok) throw new XApiError(res.status, text, where)
    return text ? (JSON.parse(text) as Json) : {}
  }

  /** 認証の確認（投稿先の垢）。ユーザー読み取り 1 件ぶんの料金がかかる。 */
  async me(): Promise<{ id: string; username: string }> {
    const r = await this.request('GET', `${API}/2/users/me`, 'users/me')
    return r.data as { id: string; username: string }
  }

  /** 動画を上げて media_id を返す。 */
  async uploadVideo(video: Buffer): Promise<{ mediaId: string; via: 'v2' | 'v1.1' }> {
    try {
      return { mediaId: await this.uploadV2(video), via: 'v2' }
    } catch (e) {
      if (e instanceof XApiError && (e.status === 401 || e.status === 403)) {
        return { mediaId: await this.uploadV1(video), via: 'v1.1' }
      }
      throw e
    }
  }

  private async uploadV2(video: Buffer): Promise<string> {
    const init = await this.request('POST', `${API}/2/media/upload/initialize`, 'media/initialize', {
      json: { media_type: 'video/mp4', total_bytes: video.length, media_category: 'tweet_video' },
    })
    const id = (init.data as { id: string }).id
    for (let i = 0; i * CHUNK < video.length; i++) {
      const form = new FormData()
      form.append('segment_index', String(i))
      form.append('media', chunkBlob(video, i), 'chunk')
      await this.request('POST', `${API}/2/media/upload/${id}/append`, 'media/append', {
        multipart: form,
      })
    }
    const fin = await this.request('POST', `${API}/2/media/upload/${id}/finalize`, 'media/finalize')
    await this.waitProcessing(
      (fin.data as Json)?.processing_info as Processing | undefined,
      () => `${API}/2/media/upload?command=STATUS&media_id=${id}`,
      (r) => (r.data as Json)?.processing_info as Processing | undefined,
    )
    return id
  }

  private async uploadV1(video: Buffer): Promise<string> {
    const init = await this.request('POST', UPLOAD_V1, 'v1.1 INIT', {
      form: {
        command: 'INIT',
        total_bytes: String(video.length),
        media_type: 'video/mp4',
        media_category: 'tweet_video',
      },
    })
    const id = init.media_id_string as string
    for (let i = 0; i * CHUNK < video.length; i++) {
      const form = new FormData()
      form.append('command', 'APPEND')
      form.append('media_id', id)
      form.append('segment_index', String(i))
      form.append('media', chunkBlob(video, i), 'chunk')
      await this.request('POST', UPLOAD_V1, 'v1.1 APPEND', { multipart: form })
    }
    const fin = await this.request('POST', UPLOAD_V1, 'v1.1 FINALIZE', {
      form: { command: 'FINALIZE', media_id: id },
    })
    await this.waitProcessing(
      fin.processing_info as Processing | undefined,
      () => `${UPLOAD_V1}?command=STATUS&media_id=${id}`,
      (r) => r.processing_info as Processing | undefined,
    )
    return id
  }

  /** 動画の変換待ち。X が示す check_after_secs に従い、最長 5 分で打ち切る。 */
  private async waitProcessing(
    first: Processing | undefined,
    statusUrl: () => string,
    pick: (r: Json) => Processing | undefined,
  ) {
    let info = first
    const deadline = Date.now() + 5 * 60_000
    while (info && info.state !== 'succeeded') {
      if (info.state === 'failed') throw new Error(`動画の変換に失敗: ${JSON.stringify(info.error)}`)
      if (Date.now() > deadline) throw new Error('動画の変換が 5 分で終わらなかった')
      await new Promise((r) => setTimeout(r, Math.max(1, info?.check_after_secs ?? 3) * 1000))
      info = pick(await this.request('GET', statusUrl(), 'media STATUS'))
    }
  }

  /** 投稿する。 */
  async createPost(text: string, mediaIds: string[]): Promise<{ id: string }> {
    const r = await this.request('POST', `${API}/2/tweets`, 'tweets', {
      json: { text, media: { media_ids: mediaIds } },
    })
    return r.data as { id: string }
  }
}

interface Processing {
  state: 'pending' | 'in_progress' | 'succeeded' | 'failed'
  check_after_secs?: number
  error?: unknown
}

/**
 * X の文字数（重み付き）。日本語など多くの文字は 2、ラテン文字などは 1、URL は一律 23。
 * 上限は 280（全角だけなら 140 字）。twitter-text の既定の重み表の要約。
 */
export function weightedLength(text: string): number {
  const urlRe = /https?:\/\/\S+/g
  const urls = text.match(urlRe) ?? []
  let n = urls.length * 23
  for (const ch of text.replace(urlRe, '')) {
    const c = ch.codePointAt(0) ?? 0
    const light =
      (c >= 0x0000 && c <= 0x10ff) ||
      (c >= 0x2000 && c <= 0x200d) ||
      (c >= 0x2010 && c <= 0x201f) ||
      (c >= 0x2032 && c <= 0x2037)
    n += light ? 1 : 2
  }
  return n
}

export const hasUrl = (text: string) => /https?:\/\/|\b[\w-]+\.(com|org|net|jp|io|dev|app)\b/i.test(text)
