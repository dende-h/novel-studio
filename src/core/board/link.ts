/**
 * 掲示板の外部リンク（自動リンクと OGP カード）の判断だけを集めた純ロジック。
 *
 * サーバが「利用者の書いた URL」を取りに行く機能なので、素朴に書くと SSRF の踏み台になる。
 * そこで **取りに行ってよいかの判断（canFetchUrl）・比較用の正規化（normalizeUrl）・
 * 画像を出してよいホストの表（OGP_IMAGE_HOSTS）を、この 1 ファイルに閉じ込めてテストで固める**。
 * 実際の fetch（リダイレクト追跡・タイムアウト・本文の打ち切り）は functions 側に置き、
 * リダイレクトのたびにここの canFetchUrl を通し直す（設計書 09-board §3.1）。
 * 表や規則が 2 箇所に散ると片方だけ緩んで穴になるため、増やすときもここへ足す。
 */

// ---------------------------------------------------------------------------
// 本文からの URL 抽出
// ---------------------------------------------------------------------------

/**
 * 裸の URL に使ってよい文字（RFC 3986 の予約語＋非予約語）。
 * ASCII だけを許すのが要点で、全角括弧・句読点・日本語は自動的に URL の外側に落ちる。
 */
const URL_BODY_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi

/** 末尾にあれば URL の一部と見なさない ASCII 約物（文末のピリオドや読点の巻き込み対策）。 */
const TRAILING_PUNCTUATION = '.,;:!?\'"'

function countChar(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n++
  return n
}

/**
 * 末尾の約物を削る。閉じ括弧は「開きより多いときだけ」削る＝
 * `https://ja.wikipedia.org/wiki/A_(B)` の `)` は残し、`(https://example.com/a)` の `)` は落とす。
 */
function trimTrailing(url: string): string {
  let out = url
  for (;;) {
    const last = out.at(-1)
    if (last === undefined) return out
    if (TRAILING_PUNCTUATION.includes(last)) {
      out = out.slice(0, -1)
      continue
    }
    if (last === ')' && countChar(out, ')') > countChar(out, '(')) {
      out = out.slice(0, -1)
      continue
    }
    if (last === ']' && countChar(out, ']') > countChar(out, '[')) {
      out = out.slice(0, -1)
      continue
    }
    return out
  }
}

/**
 * 本文から裸の URL を出現順で抜く（重複は除く）。
 * 全角文字・日本語の直後・句読点や閉じ括弧を巻き込まない。
 * ここでは取得可否を判断しない（http: も返す＝自動リンクの対象にはなる）。
 */
export function extractUrls(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(URL_BODY_RE)) {
    const url = trimTrailing(m[0])
    // スキームだけ（`https://`）で終わるものは URL として扱わない
    if (/^https?:\/\/$/i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

// ---------------------------------------------------------------------------
// 正規化とキャッシュキー
// ---------------------------------------------------------------------------

/** 落とすトラッキングパラメータの接頭辞（utm_source / utm_medium などをまとめて外す）。 */
const TRACKING_PREFIXES = ['utm_'] as const

/**
 * 落とすトラッキングパラメータ（完全一致・小文字で比較）。
 * 中身に意味が無く、同じページが別 URL に見えてキャッシュが分裂するものだけを入れる。
 * 増やすときはここへ足す（表を 1 つに保つ）。
 */
const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_openstat',
  'ref_src',
  'ref_url',
])

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase()
  if (TRACKING_PARAMS.has(key)) return true
  return TRACKING_PREFIXES.some((p) => key.startsWith(p))
}

/**
 * 比較とキャッシュキーのための正規化。同じページが別キーに散らないようにするのが目的で、
 * 取得可否の判断はしない（http: もそのまま返す＝判断は canFetchUrl の仕事）。
 *
 * - ホストは小文字（URL が IDN を punycode に寄せる）・既定ポート（80/443）は落ちる
 * - フラグメント（#...）は落とす（サーバへ送られない＝別ページではない）
 * - トラッキングパラメータを落とし、残りが空なら `?` ごと落とす
 * - 末尾スラッシュは削る。ただしルート（`/`）だけは残す＝`https://a.example` と
 *   `https://a.example/` が同じキーになる
 * - ユーザー情報（`user@`）は**残す**。ここで落とすと canFetchUrl の検査をすり抜ける
 *
 * 失敗（URL として読めない・http(s) 以外）は null。
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null

  u.hash = ''

  const kept = new URLSearchParams()
  for (const [k, v] of u.searchParams.entries()) {
    if (!isTrackingParam(k)) kept.append(k, v)
  }
  const query = kept.toString()
  u.search = query === '' ? '' : `?${query}`

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1)
  }
  return u.href
}

/**
 * `board_links.url_key`（正規化 URL の SHA-256 先頭 32 桁）。
 * Workers とブラウザの両方で動く WebCrypto を使う（Node の crypto は import しない）。
 */
export async function urlKeyOf(normalizedUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedUrl))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// 取得可否（SSRF 対策の中心）
// ---------------------------------------------------------------------------

/** 取得を拒否する理由。UI には出さず、ログと negative cache の説明に使う。 */
export const FETCH_DENY_REASONS = [
  /** URL として読めない */
  'invalid-url',
  /** https: 以外（http: / data: / file: / gopher: …） */
  'scheme',
  /** `https://user@host/` のようなユーザー情報つき */
  'userinfo',
  /** ホストが IP リテラル（10 進・8/16 進・整数表記・IPv6 を含む） */
  'ip-literal',
  /** 名前解決の先が IP を指す形（`127.0.0.1.nip.io` などの埋め込み IPv4・ワイルドカード DNS） */
  'ip-hostname',
  /** 443 以外の明示ポート */
  'port',
  /** 自オリジン（自分自身を叩かせない） */
  'self-origin',
  /** 内部 TLD（.local / .internal / .localhost …）・ドット無しホスト・末尾ドット */
  'internal-host',
] as const

export type FetchDenyReason = (typeof FETCH_DENY_REASONS)[number]

/** 取得可否の判定結果。ok のとき url は正規化済み（そのままキャッシュキーに使える）。 */
export type FetchUrlResult = { ok: true; url: string } | { ok: false; reason: FetchDenyReason }

/**
 * 自オリジンの既定値。ドット境界の接尾辞一致で照合するので、
 * `pages.dev` は `*.pages.dev` を、`localhost` は `*.localhost` を含む。
 * 本番のホストが増えたら opts.selfHosts で足す（環境変数から渡す想定）。
 */
export const DEFAULT_SELF_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  'pages.dev',
  'cotonoha-leaf.org',
]

/** 外に出ない名前空間。ここに当たるホストは名前解決の先が内部なので取りに行かない。 */
const INTERNAL_TLDS: readonly string[] = [
  'local',
  'localhost',
  'internal',
  'intranet',
  'home',
  'lan',
  'corp',
  'test',
  'invalid',
  'onion',
]

/**
 * ホスト名に IP を埋めて内側を指すワイルドカード DNS サービス（接尾辞一致で拒否）。
 *
 * **主の防御はあくまで下の `hasEmbeddedIpv4`**（この種のサービスは無数にあり、表では追えない）。
 * ここに置くのは**パターンでは見えない形**だけ:
 * - `7f000001.sslip.io` のような 16 進 1 ラベル表記（数字の並びに見えない）
 * - `localtest.me` / `lvh.me` のように数字が 1 つも出ないのに 127.0.0.1 へ解決する名前
 * 増やすときはここへ足す（規則を 2 箇所に散らさない）。
 */
const WILDCARD_DNS_HOSTS: readonly string[] = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'traefik.me',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'local.gd',
  'localho.st',
]

export type CanFetchOptions = {
  /** 自オリジンとして拒否するホスト（既定は DEFAULT_SELF_HOSTS）。 */
  selfHosts?: readonly string[]
}

/** 末尾ドットを落とした小文字ホスト（照合の共通前処理）。 */
export function canonicalHost(host: string): string {
  const lower = host.trim().toLowerCase()
  return lower.endsWith('.') ? lower.slice(0, -1) : lower
}

/** ドット境界での接尾辞一致（`evil-twimg.com` が `twimg.com` に当たらない）。 */
function matchesHostSuffix(host: string, pattern: string): boolean {
  const h = canonicalHost(host)
  const p = canonicalHost(pattern)
  if (p === '') return false
  return h === p || h.endsWith(`.${p}`)
}

/**
 * ホストが IP リテラルか。URL パーサは `2130706433` や `0x7f.0.0.1` を `127.0.0.1` へ
 * 正規化するが、パーサに依存せずここでも判定する（実装差で漏れると即 SSRF になるため）。
 * 「最後のラベルが数字か 0x 始まり」は WHATWG の IPv4 判定と同じ考え方で、
 * `foo.123` のような実在しないホストも巻き込むが、拒否側に倒すのが正しい。
 */
function isIpLiteralHost(host: string): boolean {
  const h = canonicalHost(host)
  if (h === '') return false
  // IPv6（URL.hostname は角括弧つきで返る）
  if (h.startsWith('[') || h.includes(':')) return true
  const labels = h.split('.')
  const last = labels.at(-1)
  if (last === undefined || last === '') return false
  return /^\d+$/.test(last) || /^0[xX][0-9a-fA-F]*$/.test(last)
}

/**
 * ホスト名の中に IPv4 が埋まっているか（`127.0.0.1.nip.io` / `10-0-0-1.sslip.io` /
 * `192.168.1.1.xip.io`）。**IP リテラルではないので `isIpLiteralHost` には当たらない**が、
 * 名前解決の結果は内部アドレスになる＝ SSRF としては同じもの。設計 §3.1 の狙いは
 * 「内側へ行かせない」なので、リテラルかどうかではなく**内側を指すか**で拒否する。
 *
 * 判定は「`.` か `-` で割った断片に、オクテットに見えるものが 4 つ連続するか」。
 * オクテットに見える＝1〜3 桁の数字で 0〜255 に収まるもの。
 *
 * 誤検知の線引き（安全側に倒すが、無闇には巻き込まない）:
 * - `www.4chan.org` … `4chan` は数字だけではないので通る
 * - `2024-01-01-1.example.com` … `2024` が 255 を超えるので通る（日付・バージョン名の救済）
 * - `3-1-4-1.example.com` … **拒否する**。実在の IP（3.1.4.1）と区別が付かないので巻き込む。
 *   ここを通すには「オクテットに見える 4 連続」を諦めるしかなく、それは穴のほうが大きい。
 *   正当なホストが引っかかったら、許可ではなく**個別の申告で表に足す**運用にする。
 */
function hasEmbeddedIpv4(host: string): boolean {
  let run = 0
  for (const token of canonicalHost(host).split(/[.-]/)) {
    if (token.length >= 1 && token.length <= 3 && /^\d+$/.test(token) && Number(token) <= 255) {
      run++
      if (run >= 4) return true
    } else {
      run = 0
    }
  }
  return false
}

/** 名前解決の先が IP を指す形か（埋め込み IPv4 か、既知のワイルドカード DNS サービス）。 */
function pointsToIpByName(host: string): boolean {
  if (hasEmbeddedIpv4(host)) return true
  return WILDCARD_DNS_HOSTS.some((p) => matchesHostSuffix(host, p))
}

/** 内部向けの名前か（内部 TLD・ドットを含まない単一ラベル・末尾ドット）。 */
function isInternalHost(rawHost: string): boolean {
  const lower = rawHost.trim().toLowerCase()
  if (lower === '') return true
  if (lower.endsWith('.')) return true
  const labels = lower.split('.')
  if (labels.length < 2) return true
  const last = labels.at(-1)
  if (last === undefined || last === '') return true
  return INTERNAL_TLDS.includes(last)
}

/**
 * この URL をサーバが取りに行ってよいか（設計書 09-board §3.1・不変条件 8）。
 * **リダイレクトのたびに毎回これを通す**こと。初回だけ検査すると内側へ飛ばされる。
 */
export function canFetchUrl(url: string, opts: CanFetchOptions = {}): FetchUrlResult {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'scheme' }
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'userinfo' }
  // URL は既定ポート（443）を空文字に正規化する＝残っていれば明示の非標準ポート
  if (u.port !== '') return { ok: false, reason: 'port' }

  const host = u.hostname
  if (isIpLiteralHost(host)) return { ok: false, reason: 'ip-literal' }
  // リテラルの次に「名前解決で内側を指す形」を見る。ここが無いと `127.0.0.1.nip.io` が
  // 素通りして、取れた `<title>` がそのままカードとして掲示板に出る（盲目でない SSRF）。
  if (pointsToIpByName(host)) return { ok: false, reason: 'ip-hostname' }
  if (isInternalHost(host)) return { ok: false, reason: 'internal-host' }

  const selfHosts = opts.selfHosts ?? DEFAULT_SELF_HOSTS
  if (selfHosts.some((h) => matchesHostSuffix(host, h))) {
    return { ok: false, reason: 'self-origin' }
  }
  return { ok: true, url: normalizeUrl(u.href) ?? u.href }
}

// ---------------------------------------------------------------------------
// OGP メタの抽出
// ---------------------------------------------------------------------------

/** 取り出した値の上限（DB とカードの見た目の両方を守る）。 */
export const OGP_TITLE_MAX = 120
export const OGP_DESCRIPTION_MAX = 300

/** 走査する HTML の上限。サーバ側でも 256KB か `</head>` で打ち切っている（二重の保険）。 */
const MAX_HTML_SCAN = 256 * 1024

export type OgpMeta = {
  title: string
  description: string
  image: string
  siteName: string
}

export type ParseOgpOptions = {
  titleMax?: number
  descriptionMax?: number
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** HTML エンティティ（名前つき＋10 進/16 進の数値参照）を戻す。 */
function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      // サロゲート単体は文字にならないので、そのまま返す
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** 空白を 1 つに畳んで trim し、書記素を壊さないよう code point 単位で切り詰める。 */
function clean(text: string, max: number): string {
  const flat = decodeEntities(text).replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length <= max ? flat : chars.slice(0, max).join('')
}

/**
 * `<meta ...>` を 1 つずつ取る。属性値の中の `>`（`content="a > b"`）で切れないよう、
 * 引用符の中を先に食う。自己閉じ（`/>`）もこの形でそのまま通る。
 */
const META_TAG_RE = /<meta\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi

/** 属性 1 つ。二重引用符・単引用符・引用符なしの 3 通りを受ける。 */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g

/** タグ文字列から属性表を作る（属性名は小文字化＝順序も大小も問わない）。 */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(ATTR_RE)) {
    const name = m[1]
    if (name === undefined) continue
    out[name.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/**
 * HTML の `<head>` から OGP を抜く。og:* が無ければ `<title>` と
 * `<meta name="description">` に落ちる。値は必ずエンティティを戻してから切り詰める。
 *
 * 正規表現でよいと決めたのは、相手の HTML が壊れていても落ちないほうが大事だから
 * （DOM パーサを持ち込むと Workers の重さと壊れた HTML の例外が増える）。
 * そのぶん、属性の順序・引用符の種類・大文字小文字・自己閉じ・属性値の中の `>` に耐える形にした。
 */
export function parseOgp(html: string, opts: ParseOgpOptions = {}): OgpMeta {
  const titleMax = opts.titleMax ?? OGP_TITLE_MAX
  const descriptionMax = opts.descriptionMax ?? OGP_DESCRIPTION_MAX

  const headEnd = html.search(/<\/head\s*>/i)
  const head = (headEnd >= 0 ? html.slice(0, headEnd) : html).slice(0, MAX_HTML_SCAN)

  const og: Record<string, string> = {}
  const named: Record<string, string> = {}
  for (const m of head.matchAll(META_TAG_RE)) {
    const attrs = attrsOf(m[0])
    const content = attrs.content
    if (content === undefined) continue
    // og:* は property が正だが name で書くサイトも多いので両方拾う
    const key = (attrs.property ?? attrs.name ?? '').trim().toLowerCase()
    if (key === '') continue
    if (key.startsWith('og:')) {
      if (og[key] === undefined) og[key] = content
    } else if (named[key] === undefined) {
      named[key] = content
    }
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)
  const title = og['og:title'] ?? titleTag?.[1] ?? ''
  const description = og['og:description'] ?? named.description ?? ''

  return {
    title: clean(title, titleMax),
    description: clean(description, descriptionMax),
    image: clean(og['og:image'] ?? '', 2048),
    siteName: clean(og['og:site_name'] ?? '', titleMax),
  }
}

// ---------------------------------------------------------------------------
// 画像ホストの許可表
// ---------------------------------------------------------------------------

/**
 * `og:image` を直リンクで出してよいホスト（D-BOARD-OGPIMG）。
 * ドット境界の接尾辞一致で照合するので、`twimg.com` は `pbs.twimg.com` を含み、
 * `evil-twimg.com` は含まない。
 *
 * **確実に分かるものだけを初期値に置く。** 主要サイトでも実際に返る `og:image` の
 * ホストは変わるので、**投稿の実レスポンスを見て 1 つずつ足す運用**にする（要望が来たら足す）。
 * grove（自サイト）の画像ホストは環境ごとに違うため、opts / 引数で足せる形にしてある。
 * ここは CSP の `img-src` の生成元にもなるので、表を 2 箇所へ散らさない。
 */
export const OGP_IMAGE_HOSTS: readonly string[] = [
  // 自サイト（コトノハ-grove-）。作品カードは別経路だが、汎用 OGP でも出す
  'cotonoha-grove.org',
  'grove.cotonoha-leaf.org',
  // X（Twitter）
  'pbs.twimg.com',
  // YouTube
  'i.ytimg.com',
  'img.youtube.com',
  // note
  'assets.st-note.com',
  // GitHub
  'opengraph.githubassets.com',
  'repository-images.githubusercontent.com',
]

/**
 * 画像ホストが許可表にあるか。**ドット境界での接尾辞一致**（不変条件 9）。
 * 大文字・末尾ドットは正規化してから比較する。
 */
export function isAllowedImageHost(
  host: string,
  hosts: readonly string[] = OGP_IMAGE_HOSTS,
): boolean {
  const h = canonicalHost(host)
  if (h === '') return false
  return hosts.some((p) => matchesHostSuffix(h, p))
}

/**
 * og:image を表示できる絶対 URL に直す。相対 URL はページ URL で解決し、
 * https 以外と許可表の外のホストは**空文字**に落とす（＝テキストカードで出す）。
 */
export function resolveImageUrl(
  ogImage: string,
  pageUrl: string,
  hosts: readonly string[] = OGP_IMAGE_HOSTS,
): string {
  const raw = ogImage.trim()
  if (raw === '') return ''
  let u: URL
  try {
    u = new URL(raw, pageUrl)
  } catch {
    return ''
  }
  if (u.protocol !== 'https:') return ''
  if (!isAllowedImageHost(u.hostname, hosts)) return ''
  return u.href
}
