import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { GlossaryEntry } from '@/core/schema'
import { CommitTextarea } from './commit-textarea'

/**
 * 記法つきの複数行入力（プロットの要約・メモ、用語集の公開情報・作者メモ）。
 * 「書く」と「プレビュー」を切り替えられる。本文と同じ記法（[[用語]]・｜漢字《かんじ》・
 * 《《傍点》》）が使え、プレビューでは用語集に居る語がリンクになる（クリックで
 * その用語を見る＝紐づく用語をその場で確認できる）。
 */
export function NotationField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  resolvedNames,
  glossary,
  onCreateEntry,
  onRefClick,
  textareaClassName,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** 用語集に居る語の集合（プレビューの解決/未解決の描き分け）。 */
  resolvedNames: Set<string>
  /** 用語集（@ / [[ のサジェスト候補）。空ならサジェストしない。 */
  glossary: GlossaryEntry[]
  /** 候補に無い語をその場で用語集に登録する（サジェスト末尾の作成行）。 */
  onCreateEntry?: (name: string) => Promise<string | null>
  /** プレビュー内の参照クリック。未指定ならリンクにしない。 */
  onRefClick?: (name: string) => void
  /** 入力欄へ足すクラス（最小高さの調整など）。 */
  textareaClassName?: string
}) {
  // 既定はプレビュー（読むのが主・記法の記号を出さない）。空のときだけ編集で開き、
  // すぐ書き始められるようにする。対象が変わるとパネルごと作り直されるのでここへ戻る。
  const [mode, setMode] = useState<'edit' | 'preview'>(value.trim() === '' ? 'edit' : 'preview')
  const html = useMemo(
    () => (mode === 'preview' ? blocksToHtml(parseEpisodeBody(value), resolvedNames) : ''),
    [mode, value, resolvedNames],
  )
  const previewRef = useRef<HTMLDivElement>(null)

  // dangerouslySetInnerHTML で描いた .ref をリンク化してクリックを委譲する（PreviewPane と同じ作法）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は innerHTML 再描画の検知に必要
  useEffect(() => {
    const el = previewRef.current
    if (!el || !onRefClick) return
    for (const ref of el.querySelectorAll<HTMLElement>('.ref[data-ref-name]')) {
      ref.setAttribute('role', 'link')
      ref.tabIndex = 0
    }
    const handle = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref-name]')
      if (!target) return
      if (e.type === 'keydown') {
        const key = (e as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        e.preventDefault()
      }
      onRefClick(target.getAttribute('data-ref-name') ?? '')
    }
    el.addEventListener('click', handle)
    el.addEventListener('keydown', handle)
    return () => {
      el.removeEventListener('click', handle)
      el.removeEventListener('keydown', handle)
    }
  }, [html, onRefClick])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 self-end">
        <ModeTab active={mode === 'edit'} onClick={() => setMode('edit')}>
          書く
        </ModeTab>
        <ModeTab active={mode === 'preview'} onClick={() => setMode('preview')}>
          プレビュー
        </ModeTab>
      </div>
      {mode === 'edit' ? (
        <CommitTextarea
          value={value}
          onCommit={onCommit}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          glossary={glossary}
          onCreateEntry={onCreateEntry}
          className={textareaClassName}
        />
      ) : value.trim() === '' ? (
        <button
          type="button"
          onClick={() => setMode('edit')}
          className="w-full rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-left text-[12px] text-on-surface-variant/50 hover:border-primary/40"
        >
          （まだ書かれていません）クリックで書く
        </button>
      ) : (
        <div
          ref={previewRef}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: core/exporter が全エスケープ済みの安全な HTML
          dangerouslySetInnerHTML={{ __html: html }}
          className="preview notation-preview rounded-md border border-outline-variant/30 bg-surface-variant px-2.5 py-1.5 text-on-surface"
        />
      )}
    </div>
  )
}

/** 「書く／プレビュー」の小さな切替タブ。 */
function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
        active
          ? 'bg-surface-container-high font-medium text-on-surface'
          : 'text-on-surface-variant/60 hover:text-on-surface'
      }`}
    >
      {children}
    </button>
  )
}
