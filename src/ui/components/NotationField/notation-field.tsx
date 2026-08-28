import type { ReactNode } from 'react'
import { useState } from 'react'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'
import { CommitTextarea } from './commit-textarea'
import { NotationText } from './notation-text'

/**
 * 記法つきの複数行入力（プロットの要約・メモ、世界観設定、用語集の公開情報・作者メモ）。
 * 「書く」と「プレビュー」を切り替えられる。本文と同じ記法（[[用語]]・｜漢字《かんじ》・
 * 《《傍点》》）が使え、プレビューでは用語集に居る語がリンクになる（クリックで
 * その用語を見る＝紐づく用語をその場で確認できる）。
 * プレビューは軽量マークダウン（見出し・リスト・表・引用・区切り線・**強調**）も
 * 描画する（core/markdown。保存されるのは生テキストのまま＝本文・スキーマは不変）。
 */
export function NotationField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  id,
  resolvedNames,
  glossary,
  onCreateEntry,
  onRefClick,
  textareaClassName,
  fill = false,
  defaultMode = 'auto',
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** ラベル要素と結びつけるための id（省略可）。 */
  id?: string
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
  /**
   * true なら親の高さを使い切り、編集・プレビューとも自分の中でスクロールする
   * （世界観設定のように欄が画面の高さを占める場所向け）。既定は内容ぶんに伸びる。
   */
  fill?: boolean
  /**
   * 'auto'（既定）＝中身があればプレビューで開く（読むのが主）。
   * 'edit'＝常に編集で開く（世界観設定のような書くのが主の画面向け）。
   */
  defaultMode?: 'auto' | 'edit'
}) {
  // 既定はプレビュー（読むのが主・記法の記号を出さない）。空のときだけ編集で開き、
  // すぐ書き始められるようにする。対象が変わるとパネルごと作り直されるのでここへ戻る。
  const [mode, setMode] = useState<'edit' | 'preview'>(
    defaultMode === 'edit' || value.trim() === '' ? 'edit' : 'preview',
  )
  return (
    <div className={cn('flex flex-col gap-1', fill && 'min-h-0 flex-1')}>
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
          id={id}
          value={value}
          onCommit={onCommit}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          glossary={glossary}
          onCreateEntry={onCreateEntry}
          grow={!fill}
          wrapperClassName={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}
          className={textareaClassName}
        />
      ) : value.trim() === '' ? (
        <button
          type="button"
          onClick={() => setMode('edit')}
          className={cn(
            'w-full rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-left text-[12px] text-on-surface-variant/50 hover:border-primary/40',
            fill && 'min-h-0 flex-1',
          )}
        >
          （まだ書かれていません）クリックで書く
        </button>
      ) : (
        <NotationText
          text={value}
          resolvedNames={resolvedNames}
          onRefClick={onRefClick}
          className={cn(
            'rounded-md border border-outline-variant/30 bg-surface-variant px-2.5 py-1.5 text-on-surface',
            fill && 'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]',
          )}
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
