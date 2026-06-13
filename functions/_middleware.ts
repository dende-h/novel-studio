// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// Preview(=stg)環境のみベーシック認証で保護する。
// 認証情報は Cloudflare ダッシュボードの「Preview」スコープにのみ設定し、
// 本番(main)では未設定のままにすることで本番は認証なしで素通しする。
// （CLI経由の Direct Upload シークレットは context.env へ届かない既知不具合が
//   あるため、認証情報はダッシュボードで設定すること）

interface Env {
  BASIC_AUTH_USER?: string
  BASIC_AUTH_PASS?: string
}

interface MiddlewareContext {
  request: Request
  env: Env
  next: () => Promise<Response>
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const { BASIC_AUTH_USER, BASIC_AUTH_PASS } = context.env

  // 認証情報が無い環境（=本番）は素通しする。
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
    return context.next()
  }

  const header = context.request.headers.get('Authorization')
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice('Basic '.length))
    const sep = decoded.indexOf(':')
    const user = decoded.slice(0, sep)
    const pass = decoded.slice(sep + 1)
    if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
      return context.next()
    }
  }

  return new Response('認証が必要です。', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="novel-studio (staging)", charset="UTF-8"',
    },
  })
}
