/// <reference types="@cloudflare/workers-types" />
/**
 * 掲示板の外部リンク取得（設計 docs/requirement/09-board.md §3.1・D-BOARD-OGPCACHE）。
 *
 * **掲示板でいちばん危ない処理。** 利用者が本文に書いた URL を、サーバが自分の足で
 * 取りに行く＝素朴に書くと SSRF の踏み台になる。ここで守るのは 2 つ。
 *
 *   1. **どこへ行ってよいかの判断を自分で書かない。** `src/core/board/link.ts` の
 *      `canFetchUrl` を通す。同じ規則が 2 箇所にあると片方だけ緩んで穴になるので、
 *      判断はあちらに 1 本化し、こちらは「行って・止めて・打ち切る」だけを持つ。
 *   2. **リダイレクトのたびに検査をやり直す。** 初回だけ検査すると、外向きの URL から
 *      302 で内側（127.0.0.1 やメタデータサーバ）へ飛ばされる。だから `redirect: 'manual'`
 *      で 1 ホップずつ自分で追い、毎回 `canFetchUrl` に掛け直す。
 *
 * 取得は**投稿を保存するときの 1 回だけ**で、閲覧では外に出ない（D-BOARD-OGPCACHE）。
 * 成功は 7 日、失敗（拒否・404・タイムアウト）は `kind='none'` で 1 時間キャッシュする＝
 * 壊れた URL を連打されても相手サイトを叩き続けない。
 *
 * 呼び出し側（スレ立て・返信）は返った `LinkCard[]` を `board_post_links` に結ぶ。
 * その `url_key` は `urlKeyOf(card.url)` で作れる（`card.url` は正規化済みの URL）。
 */

import {
  canFetchUrl,
  DEFAULT_SELF_HOSTS,
  extractUrls,
  type FetchUrlResult,
  normalizeUrl,
  OGP_IMAGE_HOSTS,
  type OgpMeta,
  parseOgp,
  resolveImageUrl,
  urlKeyOf,
} from '../../../src/core/board/link'
import { BOARD_LIMITS, type LinkCard, type LinkKind } from '../../../src/core/board/types'
import { type LinkRow, readLinks, toLinkCards, upsertLink } from './board-store'

// ---------------------------------------------------------------------------
// 上限（設計 §3.1 の数値。ここが唯一の定義）
// ---------------------------------------------------------------------------

/** 1 本の URL に使える時間。**リダイレクト全体で 1 つの締切**にする（3 秒 × 4 ホップにしない）。 */
const FETCH_TIMEOUT_MS = 3_000

/** 追ってよいリダイレクトの回数（＝ fetch は最大 4 回）。 */
const MAX_REDIRECTS = 3

/** 読み込む HTML の上限。`</head>` が来なくてもここで打ち切る。 */
const MAX_HTML_BYTES = 256 * 1024

/** 取得できたときの TTL（7 日）。 */
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 失敗したときの TTL（1 時間）。短いのは、直った URL がその日のうちに出るようにするため。 */
const FAIL_TTL_MS = 60 * 60 * 1000

/** 追いかけるリダイレクトの status。 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** `</head>` の検出。`test()` を繰り返すので **g フラグは付けない**（lastIndex を持たせない）。 */
const HEAD_END_RE = /<\/head\s*>/i

/** 相手のログに何者か残す。非 ASCII はヘッダに入れられないので英字で書く。 */
const USER_AGENT = 'CotonohaBoardBot/1.0 (+https://cotonoha-leaf.org/)'

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

export interface BoardLinkEnv {
  DB: D1Database
  /**
   * grove（コトノハ-grove-）の公開サイトのオリジン。ここのホストの URL は
   * `kind='work'` にして作品カードで出す（D-BOARD-WORKCARD）。未設定なら普通の OGP 扱い。
   */
  PLATFORM_ORIGIN?: string
  /** 自オリジンとして取得を拒むホストの追加（カンマ区切り・任意）。本番でホストが増えたとき用。 */
  BOARD_SELF_HOSTS?: string
}

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

/** D1 は INTEGER を string で返すことがあるので、数値比較の前に必ず通す。 */
const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0

/** URL 文字列のホスト（小文字）。読めなければ空文字。 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** 自オリジンとして拒むホストの一覧（既定 ＋ 環境変数）。 */
function selfHostsOf(env: BoardLinkEnv): readonly string[] {
  const extra = (env.BOARD_SELF_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '')
  return extra.length === 0 ? DEFAULT_SELF_HOSTS : [...DEFAULT_SELF_HOSTS, ...extra]
}

/**
 * 取得可否。判断の本体は `canFetchUrl`（`src/core/board/link.ts`）で、ここが足すのは
 * **grove の 1 ホストだけの例外**。本番の grove は `grove.cotonoha-leaf.org` ＝自オリジンの
 * 接尾辞に当たって拒否されるが、そこは自分たちのサイトなので取りに行きたい。
 *
 * 緩めるのは `self-origin` の 1 理由だけで、しかも**ホストが完全一致するときだけ**。
 * https・ポート・IP リテラル・内部 TLD の検査は素通ししない。この形なので、
 * grove から `cotonoha-leaf.org`（自分自身）へ 302 で飛ばされても、次のホップで止まる。
 */
function inspectUrl(url: string, selfHosts: readonly string[], groveHost: string): FetchUrlResult {
  const strict = canFetchUrl(url, { selfHosts })
  if (strict.ok || strict.reason !== 'self-origin' || groveHost === '') return strict
  const relaxed = canFetchUrl(url, { selfHosts: [] })
  if (!relaxed.ok) return relaxed
  return hostnameOf(relaxed.url) === groveHost ? relaxed : strict
}

/** 読まないと決めた本文を捨てる（相手との接続を握ったままにしない）。 */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // 既に閉じている場合は何もしない
  }
}

/**
 * HTML を**ストリームで**読み、`</head>` か 256KB で打ち切る。
 * `res.text()` を呼ばないのが要点＝相手が 1GB を返しても、こちらは 256KB しか読まない。
 */
async function readHtmlHead(res: Response): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (HEAD_END_RE.test(html)) break
      if (bytes >= MAX_HTML_BYTES) break
    }
  } finally {
    // 打ち切ったあとの残りは受け取らない
    try {
      await reader.cancel()
    } catch {
      // 既に閉じている場合は何もしない
    }
  }
  return html
}

// ---------------------------------------------------------------------------
// 取得（1 URL ぶん）
// ---------------------------------------------------------------------------

type FetchOk = { finalUrl: string; meta: OgpMeta }

/**
 * 1 本の URL を取りに行き、OGP を返す。取れなければ null（＝ negative cache 行になる）。
 * 拒否・タイムアウト・404・HTML でない、のどれも同じ null に畳む＝呼び出し側の分岐を増やさない。
 */
async function fetchOgp(
  startUrl: string,
  selfHosts: readonly string[],
  groveHost: string,
): Promise<FetchOk | null> {
  // 締切はリダイレクト全体で 1 つ。ホップごとに 3 秒だと最悪 12 秒待つことになる。
  // 生成は最初の fetch の直前まで遅らせる＝1 本も取りに行かないときにタイマーを作らない。
  let signal: AbortSignal | null = null
  let target = startUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // **毎ホップ検査する。** ここを初回だけにすると 302 で内側へ飛ばされる（設計 §3.1）。
    const check = inspectUrl(target, selfHosts, groveHost)
    if (!check.ok) return null

    let res: Response
    try {
      signal ??= AbortSignal.timeout(FETCH_TIMEOUT_MS)
      res = await fetch(check.url, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html,application/xhtml+xml;q=0.9', 'user-agent': USER_AGENT },
      })
    } catch {
      // タイムアウト・名前解決の失敗・接続断はすべて「取れなかった」に畳む
      return null
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      await discard(res)
      const location = res.headers.get('location')
      if (!location) return null
      let next: string
      try {
        next = new URL(location, check.url).href
      } catch {
        return null
      }
      target = next
      continue
    }

    if (res.status !== 200) {
      await discard(res)
      return null
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'text/html') {
      await discard(res)
      return null
    }

    let html: string
    try {
      html = await readHtmlHead(res)
    } catch {
      return null
    }
    return { finalUrl: check.url, meta: parseOgp(html) }
  }

  // リダイレクトが多すぎる（ループを含む）
  return null
}

// ---------------------------------------------------------------------------
// 行の組み立て
// ---------------------------------------------------------------------------

type Target = { key: string; url: string; host: string }

/** 取れなかった URL の negative cache 行（1 時間）。 */
function noneRow(t: Target, now: number): LinkRow {
  return {
    url_key: t.key,
    url: t.url,
    host: t.host,
    kind: 'none',
    title: '',
    description: '',
    image_url: '',
    image_ok: 0,
    site_name: '',
    fetched_at: now,
    expires_at: now + FAIL_TTL_MS,
    blocked_at: 0,
  }
}

/** 取れた URL のキャッシュ行（7 日）。`image_ok=0` ならテキストカードに落ちる。 */
function okRow(t: Target, kind: LinkKind, meta: OgpMeta, imageUrl: string, now: number): LinkRow {
  return {
    url_key: t.key,
    url: t.url,
    host: t.host,
    kind,
    title: meta.title,
    description: meta.description,
    image_url: imageUrl,
    image_ok: imageUrl === '' ? 0 : 1,
    site_name: meta.siteName,
    fetched_at: now,
    expires_at: now + OK_TTL_MS,
    blocked_at: 0,
  }
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * 本文から URL を抜き、キャッシュに無いものだけ取りに行って `board_links` に入れ、
 * 表示できるカードだけを**本文での出現順**で返す。
 *
 * カードにならないもの: 取得を拒否した URL / 取れなかった URL（`kind='none'`）/
 * 運営が潰した URL（`blocked_at`）。**投稿そのものは常に保存される**＝リンクが 1 本
 * 死んでいるせいで書き込みが失敗する、という作りにはしない（例外を投げない）。
 *
 * @param now ハンドラの入口で 1 回だけ読んだ `Date.now()`
 */
export async function resolveLinkCards(
  env: BoardLinkEnv,
  body: string,
  now: number,
): Promise<LinkCard[]> {
  const selfHosts = selfHostsOf(env)
  const groveHost = hostnameOf(env.PLATFORM_ORIGIN ?? '')
  // grove の画像ホストは環境ごとに違うので、許可表に実行時で足す（表の生成元は 1 箇所のまま）。
  const imageHosts = groveHost === '' ? OGP_IMAGE_HOSTS : [...OGP_IMAGE_HOSTS, groveHost]

  // 1) 先頭 linksPerPost 本だけを扱う。3 本目以降は自動リンクになるだけでカードを作らない。
  //    正規化してから重複を畳む＝ utm 違いの同じページを 2 回取りに行かない。
  const targets: Target[] = []
  const seen = new Set<string>()
  for (const raw of extractUrls(body).slice(0, BOARD_LIMITS.linksPerPost)) {
    const url = normalizeUrl(raw)
    if (url === null) continue
    const host = hostnameOf(url)
    if (host === '') continue
    const key = await urlKeyOf(url)
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ key, url, host })
  }
  if (targets.length === 0) return []

  // 2) キャッシュを引く
  const rows = new Map<string, LinkRow>()
  for (const row of await readLinks(
    env.DB,
    targets.map((t) => t.key),
  )) {
    rows.set(row.url_key, row)
  }

  // 3) 期限切れ・未取得だけ取りに行く。**blocked は取り直さない**
  //    （運営が潰した URL を、再取得の連打で復活させる経路を作らない）。
  const fresh = await Promise.all(
    targets.map(async (t): Promise<LinkRow | null> => {
      const hit = rows.get(t.key)
      if (hit && (num(hit.blocked_at) !== 0 || num(hit.expires_at) > now)) return null

      const got = await fetchOgp(t.url, selfHosts, groveHost)
      if (!got) return noneRow(t, now)

      // grove の URL は作品カード。ただし**飛び先も grove のまま**のときだけ
      //（外へリダイレクトされた先の中身を「自分の作品」として出さない）。
      const isWork =
        groveHost !== '' && t.host === groveHost && hostnameOf(got.finalUrl) === groveHost
      const imageUrl = resolveImageUrl(got.meta.image, got.finalUrl, imageHosts)
      return okRow(t, isWork ? 'work' : 'ogp', got.meta, imageUrl, now)
    }),
  )

  // 4) 取り直したぶんを保存（upsertLink は blocked_at を上書きしない）
  for (const row of fresh) {
    if (!row) continue
    await upsertLink(env.DB, row)
    rows.set(row.url_key, row)
  }

  // 5) 出現順に並べ、カードにして良い行だけ返す（none と blocked の除外は store の責務）
  const ordered: LinkRow[] = []
  for (const t of targets) {
    const row = rows.get(t.key)
    if (row) ordered.push(row)
  }
  return toLinkCards(ordered)
}
