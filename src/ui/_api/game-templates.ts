import {
  type TemplateEntry,
  TemplateEntrySchema,
  type TemplateKind,
  type TemplateManifest,
  TemplateManifestSchema,
  type TemplatePatchInput,
  type TemplatePutInput,
} from '@/core/game/templates'

/**
 * 運営テンプレ（背景・立ち絵）の API クライアント。
 * - 読み口 `/game-templates/*` は誰でも（認証なし・SW がキャッシュする）。
 * - 管理 `/api/admin/templates` は staff だけ（Clerk JWT・それ以外は 404）。
 * 失敗は例外にせず戻り値で返す（テンプレが取れなくても組み込みの SVG で動き続ける）。
 */

type GetToken = () => Promise<string | null>

/** 目録を読む。取れない・壊れているときは null。 */
export async function fetchTemplateManifest(): Promise<TemplateManifest | null> {
  try {
    const res = await fetch('/game-templates/manifest.json')
    if (!res.ok) return null
    const parsed = TemplateManifestSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 実体（WebP）を取る。取れなければ null。 */
export async function fetchTemplateBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/webp'
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 管理（staff）
// ---------------------------------------------------------------------------

const ADMIN_PATH = '/api/admin/templates'

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** 管理用の目録（非表示も含む・no-store）。staff でなければ null（404 と区別しない）。 */
export async function adminFetchTemplates(getToken: GetToken): Promise<TemplateManifest | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(ADMIN_PATH, { headers })
    if (!res.ok) return null
    const parsed = TemplateManifestSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type TemplatePutResult =
  | { ok: true; entry: TemplateEntry }
  | { ok: false; error: 'unauthorized' | 'bad_request' | 'too_large' | 'failed' }

/** 1 枚を投入・置き換え（同じ kind/slug へ送れば上書き）。 */
export async function adminPutTemplate(
  getToken: GetToken,
  kind: TemplateKind,
  slug: string,
  input: TemplatePutInput,
): Promise<TemplatePutResult> {
  const headers = await authHeader(getToken)
  if (!headers) return { ok: false, error: 'unauthorized' }
  try {
    const q = new URLSearchParams({ kind, slug })
    const res = await fetch(`${ADMIN_PATH}?${q}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 413) return { ok: false, error: 'too_large' }
    if (res.status === 400) return { ok: false, error: 'bad_request' }
    if (res.status === 401 || res.status === 404) return { ok: false, error: 'unauthorized' }
    if (!res.ok) return { ok: false, error: 'failed' }
    const parsed = TemplateEntrySchema.safeParse(((await res.json()) as { entry?: unknown }).entry)
    return parsed.success ? { ok: true, entry: parsed.data } : { ok: false, error: 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** 目録の書き換え（表示名・分類・時間帯・並び・非表示・分類の表示名）。成功なら更新後の目録。 */
export async function adminPatchTemplates(
  getToken: GetToken,
  patch: TemplatePatchInput,
): Promise<TemplateManifest | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(ADMIN_PATH, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return null
    const parsed = TemplateManifestSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
