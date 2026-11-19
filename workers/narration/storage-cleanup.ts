/// <reference types="@cloudflare/workers-types" />

import { narrationAssetKey } from '../../functions/api/_lib/narration-storage'

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
}
interface RefRow {
  user_id: string
  scope: string
  ref_id: string
  object_key: string
}
interface AssetRow {
  user_id: string
  hash: string
  storage_version: string | null
}

export async function cleanNarrationStorage(env: Env, now = Date.now()) {
  const stale = now - 86400_000
  const refs = (
    await env.DB.prepare(
      `SELECT user_id,scope,ref_id,object_key FROM narration_asset_refs
       WHERE scope!='current' AND checked_at<? ORDER BY checked_at LIMIT 60`,
    )
      .bind(stale)
      .all<RefRow>()
  ).results
  for (const ref of refs) {
    const obj = await env.MEDIA.head(ref.object_key)
    const retained =
      obj &&
      (obj.customMetadata?.narrationRef === ref.ref_id ||
        ref.ref_id === `etag:${obj.key}:${obj.etag}`)
    if (retained) {
      await env.DB.prepare(
        'UPDATE narration_asset_refs SET checked_at=? WHERE user_id=? AND scope=? AND ref_id=?',
      )
        .bind(now, ref.user_id, ref.scope, ref.ref_id)
        .run()
    } else {
      await env.DB.prepare(
        'DELETE FROM narration_asset_refs WHERE user_id=? AND scope=? AND ref_id=?',
      )
        .bind(ref.user_id, ref.scope, ref.ref_id)
        .run()
    }
  }

  // SQLite serializes this claim with new reference registration. If deletion
  // stalls, a later sweep retries it using the same immutable object key.
  await env.DB.prepare(
    `UPDATE narration_assets SET ready=2 WHERE (user_id,hash) IN (
       SELECT a.user_id,a.hash FROM narration_assets a
       WHERE a.ready IN (0,1) AND a.touched_at<?
         AND (a.storage_version IS NOT NULL OR EXISTS(
           SELECT 1 FROM narration_storage_indexed i WHERE i.user_id=a.user_id
         ))
         AND NOT EXISTS(
           SELECT 1 FROM narration_asset_refs r, json_each(r.hashes) h
           WHERE r.user_id=a.user_id AND h.value=a.hash
         )
       ORDER BY a.touched_at LIMIT 60
     )`,
  )
    .bind(stale)
    .run()
  const assets = (
    await env.DB.prepare(
      'SELECT user_id,hash,storage_version FROM narration_assets WHERE ready=2 LIMIT 60',
    ).all<AssetRow>()
  ).results
  if (!assets.length) return
  await env.MEDIA.delete(
    assets.map((row) => narrationAssetKey(row.user_id, row.hash, row.storage_version)),
  )
  await env.DB.batch(
    assets.map((row) =>
      env.DB.prepare(
        'DELETE FROM narration_assets WHERE user_id=? AND hash=? AND storage_version IS ? AND ready=2',
      ).bind(row.user_id, row.hash, row.storage_version),
    ),
  )
}
