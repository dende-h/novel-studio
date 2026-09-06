/// <reference types="@cloudflare/workers-types" />
/**
 * /api/oauth/consent — 同意画面の裏側（`#/connect` から呼ばれる）。
 *
 * **なぜ画面をアプリ内に置くか**（docs/requirement/10-mcp-oauth.md・D-OAUTH-CONSENT）:
 * `/api/oauth/authorize` の中で Clerk のセッション Cookie を直接読むより、既に全 API で
 * 実績のある「Clerk の JWT を Bearer で送る」経路（`verifyMember`）へ寄せたほうが確実で、
 * Workers 側で Cookie とハンドシェイクを相手にしなくて済む。加えて同意画面には、
 * **何を許すのかを見せる**という独立した価値がある（非会員への案内もここに置ける）。
 *
 *   GET  ?rid=…  … 何を許そうとしているかを画面へ返す（要ログイン）
 *   POST         … 許可／拒否。許可なら**認可コードを発行して飛び先の URL を返す**
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'
import {
  buildAuthorizeRedirect,
  hashSecret,
  OAUTH_PREFIX,
  OAUTH_TTL,
  randomSecret,
} from '../_lib/oauth-server'
import { deleteRequest, insertCode, readClient, readRequest } from '../_lib/oauth-store'

interface Env extends ClerkEnv {
  DB: D1Database
}

/** 同意画面の応答は利用者ごとに違う。CDN にも中間にも残さない。 */
const consentJson = (data: unknown, status = 200): Response => {
  const res = json(data, status)
  res.headers.set('cache-control', 'private, no-store')
  return res
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const member = await verifyMember(context.request, context.env)
  if (!member) return consentJson({ error: 'unauthorized' }, 401)

  const rid = new URL(context.request.url).searchParams.get('rid') ?? ''
  const req = await readRequest(context.env.DB, rid, Date.now())
  if (!req) return consentJson({ error: 'expired' }, 404)

  const client = await readClient(context.env.DB, req.clientId)
  return consentJson({
    clientName: client?.clientName ?? null,
    clientUri: client?.clientUri ?? null,
    // 飛び先のホストは画面に出す（「どこへ繋がるか」を隠さない）。
    redirectHost: safeHost(req.redirectUri),
    scope: req.scope.split(' ').filter(Boolean),
    isMember: member.isMember,
  })
}

const safeHost = (uri: string): string | null => {
  try {
    return new URL(uri).host
  } catch {
    return null
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const member = await verifyMember(context.request, context.env)
  if (!member) return consentJson({ error: 'unauthorized' }, 401)

  let body: { rid?: unknown; approve?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return consentJson({ error: 'bad_request' }, 400)
  }
  const rid = typeof body.rid === 'string' ? body.rid : ''
  const approve = body.approve === true

  const now = Date.now()
  const req = await readRequest(context.env.DB, rid, now)
  if (!req) return consentJson({ error: 'expired' }, 404)

  const origin = new URL(context.request.url).origin

  // 拒否は正常な結末。クライアントへ access_denied を返して終わる（RFC 6749）。
  if (!approve) {
    await deleteRequest(context.env.DB, rid)
    return consentJson({
      redirect: buildAuthorizeRedirect(req.redirectUri, origin, {
        error: 'access_denied',
        error_description: '利用者が接続を許可しませんでした',
        state: req.state,
      }),
    })
  }

  // 会員だけに出す（`/api/mcp` の 403 と同じ線を、押す前の画面で引く）。
  // ここで断ると、AI 側には汎用の失敗しか出ないので、画面で理由を見せてから返す。
  if (!member.isMember) return consentJson({ error: 'subscription_required' }, 402)

  const code = randomSecret(OAUTH_PREFIX.code)
  await insertCode(
    context.env.DB,
    await hashSecret(code),
    {
      userId: member.userId,
      clientId: req.clientId,
      redirectUri: req.redirectUri,
      scope: req.scope,
      resource: req.resource,
      codeChallenge: req.codeChallenge,
    },
    now + OAUTH_TTL.code,
  )
  await deleteRequest(context.env.DB, rid)

  return consentJson({
    redirect: buildAuthorizeRedirect(req.redirectUri, origin, {
      code,
      state: req.state,
    }),
  })
}
