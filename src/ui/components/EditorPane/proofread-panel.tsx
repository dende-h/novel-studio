import type { ProofNotice } from '@/core/proofread'

interface ProofreadPanelProps {
  title: string
  intro: string
  notices: ProofNotice[]
  onJump: (blockIndex: number) => void
}

/**
 * 本文の下の確認候補パネル（脚本の書式チェック）。小説の推敲は推敲画面へ移した（COT-40）。
 * 候補を押すと該当行を選択するだけで、本文は書き換えない。
 */
export function ProofreadPanel({ title, intro, notices, onJump }: ProofreadPanelProps) {
  return (
    <details className="shrink-0 border-t border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant">
      <summary className="cursor-pointer">
        {title}（確認候補 {notices.length}件）
      </summary>
      <p className="my-2">{intro}</p>
      <ul className="max-h-32 overflow-y-auto">
        {notices.map((notice) => (
          <li key={`${notice.blockIndex}-${notice.code}-${notice.message}`}>
            <button
              type="button"
              className="min-h-11 w-full py-1 text-left hover:text-primary"
              onClick={() => onJump(notice.blockIndex)}
            >
              {notice.blockIndex + 1}行：{notice.message}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
