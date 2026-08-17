import { Lightbulb, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type IdeaNote, sortIdeasByNewest } from '@/core/idea'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })

interface IdeaboxPageProps {
  repo: IdeaRepository
  /** ライブラリ（コレクション）へ戻る。左サイドバー／ブランドから使う。 */
  onNavigateCollection: () => void
  /** 執筆の記録へ（サイドバー）。 */
  onNavigateActivity?: () => void
  /** 設定ページへ（サイドバーフッター）。 */
  onNavigateSettings?: () => void
  /** ヘルプページへ（サイドバーフッター）。 */
  onNavigateHelp?: () => void
}

/**
 * ネタ帳（アイデアの受け皿・純ローカル・無料）。まだどの作品にも属さない断片を放り込んでおく。
 * ライブラリ／執筆の記録と同じ AppShell＋左サイドバーの上で、入力欄とメモ一覧を表示する。
 */
export function IdeaboxPage({
  repo,
  onNavigateCollection,
  onNavigateActivity,
  onNavigateSettings,
  onNavigateHelp,
}: IdeaboxPageProps) {
  const [notes, setNotes] = useState<IdeaNote[] | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    void repo.list().then(setNotes)
  }, [repo])

  // 同期の pull がローカルを書き換えたら開いたまま一覧を読み直す（入力中テキストは別 state で無事）。
  useEffect(() => {
    return subscribeSyncApplied(() => {
      void repo.list().then(setNotes)
    })
  }, [repo])

  const handleAdd = async () => {
    const created = await repo.add(text)
    if (!created) return
    setText('')
    setNotes((prev) => sortIdeasByNewest([created, ...(prev ?? [])]))
  }

  const handleRemove = async (id: string) => {
    await repo.remove(id)
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id))
  }

  return (
    <AppShell
      onBrandClick={onNavigateCollection}
      sidebar={
        <SideNav
          active="ideas"
          onNavigateCollection={onNavigateCollection}
          onNavigateActivity={onNavigateActivity}
          onNavigateIdeas={() => {}}
          onNavigateSettings={onNavigateSettings}
          onNavigateHelp={onNavigateHelp}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-9 md:px-10">
        <div className="mx-auto max-w-3xl pb-16">
          <header className="mb-6">
            <h1 className="font-semibold font-serif text-[26px] text-on-surface">ネタ帳</h1>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              まだ作品になっていない思いつきを、ここに放り込んでおけます
            </p>
          </header>

          {/* 入力欄（⌘/Ctrl+Enter でも追加） */}
          <div className="mb-6 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleAdd()
                }
              }}
              rows={3}
              aria-label="新しいネタ"
              placeholder="思いついた設定・タイトル・台詞の断片を書き留める…"
              className="w-full resize-y bg-transparent font-sans text-base text-on-surface outline-none placeholder:text-on-surface-variant/50 md:text-[14px]"
            />
            <div className="mt-2 flex items-center justify-between">
              {/* 物理キーボードのない狭幅では案内する意味がないので畳む。 */}
              <span className="text-[11px] text-on-surface-variant/70 max-md:hidden">
                ⌘/Ctrl + Enter で追加
              </span>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={text.trim() === ''}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 font-sans text-[13px] text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" />
                追加
              </button>
            </div>
          </div>

          {/* 一覧（新しい順） */}
          {notes === null ? (
            <p className="py-8 text-center text-on-surface-variant text-sm">読み込み中…</p>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Lightbulb className="size-8 text-on-surface-variant/40" />
              <p className="text-on-surface-variant text-sm">
                まだネタがありません。ふと浮かんだ断片を気軽に放り込みましょう 💡
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="group flex items-start gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5"
                >
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-[14px] text-on-surface">
                    {n.text}
                  </p>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      type="button"
                      aria-label="このネタを削除"
                      onClick={() => void handleRemove(n.id)}
                      // hover 専用にすると、ホバーの無いタッチ環境では永久に出せない。
                      // 狭幅では常時表示し、キーボード操作にも group-focus-within で追従する。
                      className="rounded-md p-2.5 text-on-surface-variant/50 opacity-100 transition-all hover:bg-surface-container-high hover:text-on-surface group-focus-within:opacity-100 group-hover:opacity-100 md:p-1 md:opacity-0"
                    >
                      <Trash2 className="size-4" />
                    </button>
                    <time className="whitespace-nowrap text-[11px] text-on-surface-variant/60">
                      {fmtDate(n.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  )
}
