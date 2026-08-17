/// <reference types="@cloudflare/workers-types" />
/**
 * /api/sync/version — 同期状態の世代番号（GET・超軽量）。
 *
 * 受け側の端末が「サーバに変化があったか」を高頻度（~15 秒）で安く確かめるための
 * エンドポイント。works の MAX(synced_at) と activity の MAX(updated_at) を返すだけで、
 * どちらかが前回値から動いていたらクライアントは本同期（reconcile）を走らせる。
 * manifest 全行を毎回引くより桁違いに軽く、読み取り系なのでレート制限はかけない。
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'

interface Env extends ClerkEnv {
  DB: D1Database
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const m = await verifyMember(context.request, context.env)
  if (!m) return json({ error: 'unauthorized' }, 401)
  if (!m.isMember) return json({ error: 'subscription_required' }, 402)

  const works = await context.env.DB.prepare(
    'SELECT COALESCE(MAX(synced_at), 0) AS v FROM works WHERE user_id = ?',
  )
    .bind(m.userId)
    .first<{ v: number }>()
  const activity = await context.env.DB.prepare(
    'SELECT COALESCE(MAX(updated_at), 0) AS v FROM activity WHERE user_id = ?',
  )
    .bind(m.userId)
    .first<{ v: number }>()

  return json({ works: works?.v ?? 0, activity: activity?.v ?? 0 })
}
