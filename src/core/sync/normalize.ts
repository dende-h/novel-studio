/**
 * ハッシュ入力用の決定論的シリアライズ（Phase 2）。
 *
 * オブジェクトのキーを再帰的にソートして安定した JSON 文字列を作る。これを SHA-256 に
 * かけた hex がパート（doc/media）のハッシュになる。**クライアントとサーバが必ず同じ
 * バイト列を生成する**ことが要（ハッシュ一致＝同期不要判定の単一の真実）。配列は順序を保つ。
 */

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key]
      // undefined のキーは出力しない（JSON.stringify と同じ・両側で挙動を固定）。
      if (v !== undefined) {
        sorted[key] = sortValue(v)
      }
    }
    return sorted
  }
  return value
}

/** キーをソートした決定論的 JSON 文字列を返す。 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value))
}
