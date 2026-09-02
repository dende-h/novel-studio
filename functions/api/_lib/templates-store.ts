/// <reference types="@cloudflare/workers-types" />
/**
 * 運営テンプレ（背景・立ち絵）の R2 上の置き場（D-GAME-TEMPLATE-CMS）。
 *
 *   `_templates/manifest.json`            … 目録（src/core/game/templates.ts の TemplateManifest）
 *   `_templates/<kind>/<slug>.<ext>`       … 実体（拡張子は MIME から＝webp/png/jpg/mp3/m4a）
 *   `_templates/<kind>/<slug>.thumb.<ext>` … 一覧用のサムネ（画像だけ）
 *
 * 接頭辞 `_templates/` は Clerk の user_id（`user_…`）と衝突しないので、退会時の
 * `${userId}/` 一括 purge に巻き込まれない。公開物なので暗号化はしない。
 * 読み口（functions/game-templates/）と管理 API（functions/api/admin/templates.ts）が共用する。
 */

import {
  EMPTY_TEMPLATE_MANIFEST,
  type TemplateKind,
  type TemplateManifest,
  TemplateManifestSchema,
  type TemplateVariant,
} from '../../../src/core/game/templates'

export const TEMPLATES_PREFIX = '_templates/'
export const TEMPLATE_MANIFEST_KEY = `${TEMPLATES_PREFIX}manifest.json`

export const templateObjectKey = (
  kind: TemplateKind,
  slug: string,
  variant: TemplateVariant = 'full',
  ext = 'webp',
): string => `${TEMPLATES_PREFIX}${kind}/${slug}${variant === 'thumb' ? '.thumb' : ''}.${ext}`

/** 目録を読む。無い・壊れているときは空の目録（配信を止めない）。 */
export async function readTemplateManifest(bucket: R2Bucket): Promise<TemplateManifest> {
  const obj = await bucket.get(TEMPLATE_MANIFEST_KEY)
  if (!obj) return EMPTY_TEMPLATE_MANIFEST
  try {
    const parsed = TemplateManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())),
    )
    return parsed.success ? parsed.data : EMPTY_TEMPLATE_MANIFEST
  } catch {
    return EMPTY_TEMPLATE_MANIFEST
  }
}

/** 目録を書く（丸ごと置き換え・運営は 1 人なので競合制御は持たない）。 */
export async function writeTemplateManifest(
  bucket: R2Bucket,
  manifest: TemplateManifest,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  await bucket.put(TEMPLATE_MANIFEST_KEY, bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: 'application/json' },
  })
}
