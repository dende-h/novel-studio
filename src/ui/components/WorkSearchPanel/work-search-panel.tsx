import { useEffect, useId, useMemo, useState } from 'react'
import { type SearchMatch, type SearchSource, searchWork } from '@/core/search/workSearch'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { ReplacePanel } from '@/ui/components/EditorPane/replace-panel'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'

interface Props {
  sources: readonly SearchSource[]
  value: string
  busy: boolean
  onApply: (next: string, count: number, keepOpen?: boolean) => void
  onNavigate: (sources: readonly SearchSource[], query: string, match: SearchMatch) => Promise<void>
  onReplace: (
    sources: readonly SearchSource[],
    query: string,
    replacement: string,
    target: SearchMatch | 'all',
  ) => Promise<void>
  onClose: () => void
}

export function WorkSearchPanel({
  sources,
  value,
  busy,
  onApply,
  onNavigate,
  onReplace,
  onClose,
}: Props) {
  const titleId = useId()
  const [scope, setScope] = useState<'episode' | 'work'>('episode')
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [composing, setComposing] = useState(false)
  const [result, setResult] = useState<{
    sources: readonly SearchSource[]
    query: string
    matches: SearchMatch[]
  } | null>(null)
  const [visible, setVisible] = useState(100)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<typeof result>(null)
  const sourceKey = JSON.stringify(sources)
  const currentKey = result ? JSON.stringify(result.sources) : null
  const stale = !result || result.query !== query || sourceKey !== currentKey || composing
  const matches = result?.matches ?? []
  const replaceable = matches.filter((match) => !match.isReference)
  const titles = useMemo(() => new Map(sources.map((s) => [s.episodeId, s.title])), [sources])
  const canReplace =
    !busy &&
    !stale &&
    replaceable.length > 0 &&
    query !== replacement &&
    !/[\r\n]/.test(query + replacement)

  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => {
      setResult({ sources, query, matches: searchWork(sources, query) })
      setVisible(100)
    }, 150)
    return () => clearTimeout(timer)
  }, [sources, query, composing])

  const perform = async (operation: () => Promise<void>, navigating = false) => {
    setError('')
    try {
      await operation()
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message === '本文が変わりました。検索し直してください'
          ? message
          : navigating
            ? '保存できませんでした。本文を確認して、もう一度お試しください'
            : '置換できませんでした。本文は変更していません。もう一度お試しください',
      )
    }
  }

  return (
    <section
      data-work-search-panel
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !composing && !e.nativeEvent.isComposing) {
          e.stopPropagation()
          onClose()
        }
      }}
      className="absolute top-2.5 right-3.5 z-20 flex max-h-[min(85dvh,calc(100%_-_20px))] w-[360px] flex-col gap-2.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5 font-sans shadow-lg max-lg:inset-x-2 max-lg:w-auto"
    >
      <div className="flex items-center justify-between">
        <h3 id={titleId} className="font-medium text-[13px]">
          検索・置換
        </h3>
        <Button variant="ghost" className="min-h-11" onClick={onClose}>
          閉じる
        </Button>
      </div>
      <fieldset aria-label="検索する範囲" className="flex gap-2">
        <Button
          variant={scope === 'episode' ? 'default' : 'outline'}
          className="min-h-11"
          aria-pressed={scope === 'episode'}
          onClick={() => setScope('episode')}
        >
          この話
        </Button>
        <Button
          variant={scope === 'work' ? 'default' : 'outline'}
          className="min-h-11"
          aria-pressed={scope === 'work'}
          onClick={() => setScope('work')}
        >
          作品全体
        </Button>
      </fieldset>
      {scope === 'episode' ? (
        <ReplacePanel embedded value={value} onApply={onApply} onClose={onClose} disabled={busy} />
      ) : (
        <>
          <Input
            aria-label="検索する語"
            placeholder="検索する語"
            value={query}
            disabled={busy}
            className="min-h-11"
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
          <Input
            aria-label="置換後の語"
            placeholder="置換後の語"
            value={replacement}
            disabled={busy}
            className="min-h-11"
            onChange={(e) => setReplacement(e.target.value)}
          />
          <p className="text-xs text-on-surface-variant">ルビや参照の記法も検索します</p>
          <p className="text-xs text-on-surface-variant">用語集の参照は置換しません</p>
          <p aria-live="polite" className="text-xs text-on-surface-variant">
            {busy
              ? '処理しています'
              : sources.length === 0
                ? '話を追加すると検索できます'
                : query === ''
                  ? '検索する語を入力してください'
                  : stale
                    ? '検索しています'
                    : matches.length === 0
                      ? '見つかりませんでした'
                      : `${matches.length}件・${new Set(matches.map((m) => m.episodeId)).size}話`}
          </p>
          {!stale && matches.some((match) => match.isReference) ? (
            <p className="text-xs text-on-surface-variant">{replaceable.length}件を置換できます</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="min-h-0 overflow-y-auto">
            {matches.slice(0, visible).map((match) => (
              <div
                key={`${match.episodeId}-${match.start}`}
                className="border-outline-variant/30 border-b py-2"
              >
                <button
                  type="button"
                  disabled={busy || stale}
                  className="min-h-11 w-full text-left text-xs disabled:opacity-50"
                  onClick={() => {
                    if (result)
                      void perform(() => onNavigate(result.sources, result.query, match), true)
                  }}
                >
                  <span className="block font-medium">
                    {titles.get(match.episodeId)}・{match.line}行
                  </span>
                  <span className="block break-all">
                    {match.excerpt.slice(0, match.excerptMatchStart)}
                    <mark>
                      {match.excerpt.slice(match.excerptMatchStart, match.excerptMatchEnd)}
                    </mark>
                    {match.excerpt.slice(match.excerptMatchEnd)}
                  </span>
                </button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={!canReplace || match.isReference}
                  onClick={() => {
                    if (result)
                      void perform(() =>
                        onReplace(result.sources, result.query, replacement, match),
                      )
                  }}
                >
                  この1件を置換
                </Button>
                {match.isReference ? (
                  <p className="text-xs text-on-surface-variant">用語集の参照・置換対象外</p>
                ) : null}
              </div>
            ))}
            {matches.length > visible ? (
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setVisible((n) => n + 100)}
              >
                さらに表示
              </Button>
            ) : null}
          </div>
          <Button
            className="min-h-11 shrink-0"
            disabled={!canReplace}
            onClick={() => setConfirmation(result)}
          >
            すべて置換
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={`${confirmation?.matches.filter((match) => !match.isReference).length ?? 0}件を置換しますか？`}
        confirmLabel="置換"
        destructive={false}
        description={
          <>
            {
              new Set(confirmation?.matches.filter((m) => !m.isReference).map((m) => m.episodeId))
                .size
            }
            話の本文を変更します。置換前の本文は履歴に残ります
            {replacement === '' ? `。「${confirmation?.query}」を削除します` : ''}
          </>
        }
        onConfirm={() => {
          if (confirmation)
            void perform(() =>
              onReplace(confirmation.sources, confirmation.query, replacement, 'all'),
            )
        }}
      />
    </section>
  )
}
