interface PreviewPaneProps {
  html: string
}

/**
 * ライブプレビュー。core/exporter/toHtml が生成した安全な HTML を描画する。
 * （HTML は core 側で全エスケープ済み。ユーザー入力は属性ではなくテキストとして閉じている）
 */
export function PreviewPane({ html }: PreviewPaneProps) {
  return (
    <div
      className="preview h-full overflow-auto p-4 leading-8"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML は core/toHtml で全エスケープ済み
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
