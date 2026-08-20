/// <reference types="@cloudflare/workers-types" />
/**
 * 訪問者集計（/api/hit）の純粋関数まわり。
 *
 * ねらいは「PV でも visits でもなく、**日ごとの実人数**を Cookie なしで数える」こと。
 * Cloudflare Web Analytics は Cookie レス設計ゆえ訪問者を識別せず、指標は PV（count）と
 * 外部から着地した回数（visits）だけなので、毎日来る運営者自身が毎日カウントされてしまう。
 *
 * ここでは代わりに「**その日限りの不可逆な符号**」を作る：
 *   sha256(salt : 日付 : IP : UA族 : サイト) の先頭 16 桁
 * 日付が変わると符号も変わるため、日をまたいで同一人物を追跡することはできない。
 * 元の IP には戻せず、保存もしない（符号だけを D1 に置く）。
 *
 * UA は「族」（Chrome/iOS のような粗い分類）まで丸めてから混ぜる。理由は 2 つ：
 *   - ブラウザのバージョンが上がっただけで別人扱いになるのを防ぐ（精度）
 *   - 1 つの IP から作れる行数が族の組み合わせ数（数十）に収まる（書き込みの上限）
 */

/** 計測対象サイト。stg・プレビュー（*.pages.dev）はどちらにも属さない＝記録しない。 */
export type Site = 'leaf' | 'grove'

/** ホスト名 → サイト。許可リスト型。該当しなければ null（記録しない）。 */
export function siteOf(host: string): Site | null {
  const h = host.toLowerCase()
  if (h === 'cotonoha-leaf.org' || h === 'www.cotonoha-leaf.org') return 'leaf'
  if (h === 'grove.cotonoha-leaf.org') return 'grove'
  if (h === 'cotonoha-grove.org' || h === 'www.cotonoha-grove.org') return 'grove'
  return null
}

/** Origin ヘッダ（"https://example.org"）からホスト名だけ取り出す。壊れていれば ''。 */
export function hostOfOrigin(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return ''
  }
}

/** 日本時間の日付（YYYY-MM-DD）。集計の 1 日は JST にそろえる（読み手が日本にいるため）。 */
export function jstDate(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 明らかな自動アクセスか。RUM ビーコンは本来ブラウザからしか飛ばないが、
 * ヘッドレスブラウザや素朴なクローラは実際に JS を実行するので落としておく。
 */
export function isBot(ua: string): boolean {
  return /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|headless|lighthouse|curl|wget|python-requests|node-fetch/i.test(
    ua,
  )
}

/** UA を「ブラウザ族/OS 族」に丸める（例: "Chrome/Android"）。判定順は包含関係の狭い方から。 */
export function uaFamily(ua: string): string {
  const browser = /Edg[A-Z]?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung'
      : /(Firefox|FxiOS)\//.test(ua)
        ? 'Firefox'
        : /(Chrome|CriOS)\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other'
  const os = /(iPhone|iPad|iPod|iOS)/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /(Macintosh|Mac OS X)/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other'
  return `${browser}/${os}`
}

/** 端末種別。Cloudflare 側の deviceType と読み比べられるよう同じ語彙にそろえる。 */
export function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) return 'tablet'
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'mobile'
  return 'desktop'
}

/** 記録するパス。クエリ・ハッシュを落とし、長さを 128 に切り詰める（識別子の混入と肥大を防ぐ）。 */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/'
  return raw.split(/[?#]/)[0].slice(0, 128)
}

/** 参照元のホスト名。空・不正は ''（＝直接アクセス）。 */
export function refererHostOf(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  try {
    return new URL(raw).hostname.slice(0, 64)
  } catch {
    return ''
  }
}

/**
 * その日限りの訪問者符号（16 桁の 16 進）。
 * salt は Pages のシークレット（ANALYTICS_SALT）。未設定でも動くが、設定すると
 * 「IP を総当たりして符号を突き合わせる」経路まで塞げる。
 */
export async function visitorHash(input: {
  salt: string
  date: string
  ip: string
  family: string
  site: Site
}): Promise<string> {
  const material = `${input.salt}:${input.date}:${input.ip}:${input.family}:${input.site}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
