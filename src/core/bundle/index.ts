import { z } from 'zod'
import { type Work, WorkSchema } from '../schema'

/**
 * 構造化バンドル（全作品の export/import）。
 * version 付き JSON でラップし、import 時に version とスキーマを検証する。
 */

export const BUNDLE_VERSION = 1

const BundleSchema = z.object({
  version: z.literal(BUNDLE_VERSION),
  works: z.array(WorkSchema),
})

export function exportBundle(works: Work[]): string {
  return JSON.stringify({ version: BUNDLE_VERSION, works })
}

export function importBundle(json: string): Work[] {
  const raw: unknown = JSON.parse(json)
  return BundleSchema.parse(raw).works
}
