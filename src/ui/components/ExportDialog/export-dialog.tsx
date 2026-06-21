import { BookText, Braces, Copy, Download, Folder, Globe, Pencil, Sparkles } from 'lucide-react'
import { type ComponentType, useId, useState } from 'react'
import { glossaryToPlainText, workToPlainText } from '@/core/exporter/toPlainText'
import type { Work } from '@/core/schema'
import { cn } from '@/lib/utils'
import { copyText } from '@/ui/_utils/clipboard'
import { triggerDownload } from '@/ui/_utils/download'
import {
  episodeKakuyomuExport,
  episodeNarouExport,
  workEpubExport,
  workFolderZipExport,
  worksBundleExport,
} from '@/ui/_utils/exporters'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'

type Format = 'epub' | 'web' | 'folder' | 'bundle' | 'ai'
type Platform = 'narou' | 'kakuyomu'

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 書き出し対象。エディタは現在の作品、ライブラリは選択カードの作品。 */
  work: Work | null
  /** バンドル（全作品）用 */
  getAllWorks: () => Promise<Work[]>
  /** EPUB メタ情報を編集（指定時のみ「作品情報を編集」を表示） */
  onEditMeta?: () => void
}

interface FormatDef {
  key: Format
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
  /** バンドル以外は作品が必要 */
  needsWork: boolean
}

const FORMATS: FormatDef[] = [
  {
    key: 'epub',
    icon: BookText,
    title: 'EPUB / 電子書籍',
    desc: '縦書き対応の電子書籍標準フォーマット',
    needsWork: true,
  },
  {
    key: 'web',
    icon: Globe,
    title: 'Web投稿形式',
    desc: '「なろう」「カクヨム」などの投稿用記法',
    needsWork: true,
  },
  {
    key: 'folder',
    icon: Folder,
    title: 'フォルダ(ZIP)',
    desc: '話ごとのテキストをまとめて書き出し',
    needsWork: true,
  },
  {
    key: 'ai',
    icon: Sparkles,
    title: 'AI へコピー',
    desc: '本文をまとめて AI に読ませる用にコピー',
    needsWork: true,
  },
  {
    key: 'bundle',
    icon: Braces,
    title: '構造化データ',
    desc: 'バックアップ用の JSON データ一括出力',
    needsWork: false,
  },
]

/** 書き出しモーダル。左に形式、右に設定。core の各 exporter を配線する。 */
export function ExportDialog({
  open,
  onOpenChange,
  work,
  getAllWorks,
  onEditMeta,
}: ExportDialogProps) {
  const [format, setFormat] = useState<Format>('epub')
  const [platform, setPlatform] = useState<Platform>('narou')
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'err' | null>(null)
  const [includeGlossary, setIncludeGlossary] = useState(false)
  const glossaryToggleId = useId()
  const glossaryCount = work?.glossary?.length ?? 0

  const episodes = work?.episodes ?? []
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0] ?? null

  const canExport =
    format === 'bundle'
      ? true
      : format === 'web' || format === 'ai'
        ? Boolean(work) && episodes.length > 0
        : Boolean(work)

  // ダイアログを閉じるときはコピー結果メッセージをリセット
  const handleOpenChange = (next: boolean) => {
    if (!next) setCopied(null)
    onOpenChange(next)
  }

  const handleExport = async () => {
    if (format === 'ai') {
      if (work) {
        const glossary = work.glossary ?? []
        const text =
          includeGlossary && glossary.length > 0
            ? `${workToPlainText(work)}\n\n${glossaryToPlainText(glossary)}`
            : workToPlainText(work)
        setCopied((await copyText(text)) ? 'ok' : 'err')
      }
      return // コピーはダイアログを閉じず、結果メッセージを見せる
    }
    if (format === 'bundle') {
      triggerDownload(worksBundleExport(await getAllWorks()))
    } else if (work) {
      if (format === 'epub') triggerDownload(workEpubExport(work))
      else if (format === 'folder') triggerDownload(workFolderZipExport(work))
      else if (format === 'web' && selectedEpisode) {
        triggerDownload(
          platform === 'narou'
            ? episodeNarouExport(work.title, selectedEpisode)
            : episodeKakuyomuExport(work.title, selectedEpisode),
        )
      }
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-3xl lg:max-w-5xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-outline-variant/30 border-b px-6 py-4 text-left">
          <DialogTitle className="font-serif text-primary text-xl">
            プロジェクトの書き出し
          </DialogTitle>
          <DialogDescription>{work ? work.title : '全作品のバックアップ'}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[360px] flex-col md:flex-row">
          {/* 形式リスト */}
          <nav className="flex flex-col gap-2 border-outline-variant/30 border-b bg-surface-container-low p-4 md:w-1/3 md:border-r md:border-b-0">
            {FORMATS.map(({ key, icon: Icon, title, desc }) => {
              const active = format === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFormat(key)
                    setCopied(null)
                  }}
                  className={cn(
                    'flex items-start gap-3 rounded-md p-3 text-left font-sans transition-colors',
                    active
                      ? 'border-primary border-l-4 bg-surface-container-highest'
                      : 'text-on-surface-variant hover:bg-surface-container-high',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-5 shrink-0', active && 'text-primary')} />
                  <div className="min-w-0">
                    <div className={cn('font-medium text-sm', active && 'text-primary')}>
                      {title}
                    </div>
                    <p className="mt-0.5 text-on-surface-variant text-xs">{desc}</p>
                  </div>
                </button>
              )
            })}
          </nav>

          {/* 設定 */}
          <div className="flex-1 p-6 font-sans">
            {format === 'epub' && (
              <Section title="EPUB 設定">
                <div className="space-y-4">
                  <Note>
                    1作品＝1冊として、縦書き EPUB
                    を書き出します。電子書籍リーダーでそのまま読めます。
                  </Note>
                  <dl className="space-y-2 rounded-md border border-outline-variant/30 p-4 text-sm">
                    <MetaRow label="タイトル" value={work?.title} />
                    <MetaRow label="著者" value={work?.author} />
                    <MetaRow label="あらすじ" value={work?.description} />
                  </dl>
                  {onEditMeta ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onEditMeta}
                      className="gap-2 text-primary"
                    >
                      <Pencil className="size-4" />
                      作品情報を編集
                    </Button>
                  ) : null}
                </div>
              </Section>
            )}

            {format === 'web' && (
              <Section title="Web投稿 設定">
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 text-on-surface-variant text-xs uppercase tracking-wider">
                      投稿先
                    </div>
                    <div className="flex gap-2">
                      {(['narou', 'kakuyomu'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPlatform(p)}
                          className={cn(
                            'rounded-full border px-4 py-1.5 text-sm transition-colors',
                            platform === p
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high',
                          )}
                        >
                          {p === 'narou' ? 'なろう' : 'カクヨム'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="export-episode"
                      className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                    >
                      話を選択
                    </label>
                    <select
                      id="export-episode"
                      value={selectedEpisode?.id ?? ''}
                      onChange={(e) => setEpisodeId(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-on-surface text-sm outline-none focus:border-primary"
                    >
                      {episodes.length === 0 ? (
                        <option value="">（話がありません）</option>
                      ) : (
                        episodes.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </Section>
            )}

            {format === 'folder' && (
              <Section title="フォルダ(ZIP) 設定">
                <Note>
                  話ごとのテキストファイルをフォルダ構成のまま ZIP にまとめて書き出します。
                </Note>
              </Section>
            )}

            {format === 'ai' && (
              <Section title="AI へコピー">
                <div className="space-y-4">
                  <Note>
                    作品全体をプレーンテキストにまとめてクリップボードへコピーします。Claude や
                    ChatGPT
                    などに貼り付けて、感想・推敲・要約などを頼めます。ルビは「親文字（よみ）」、
                    @参照は名前に展開されます。
                  </Note>
                  {glossaryCount > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant/30 p-3">
                      <Label
                        htmlFor={glossaryToggleId}
                        className="font-normal text-on-surface text-sm"
                      >
                        登録した図鑑も一緒にコピー
                        <span className="mt-0.5 block text-on-surface-variant text-xs">
                          人物・用語などの設定（{glossaryCount} 件）を本文の後ろに付けます。
                        </span>
                      </Label>
                      <Switch
                        id={glossaryToggleId}
                        checked={includeGlossary}
                        onCheckedChange={setIncludeGlossary}
                      />
                    </div>
                  )}
                  <p className="rounded-md border border-outline-variant/30 p-3 text-on-surface-variant text-xs leading-relaxed">
                    ※ コピーした本文を AI
                    サービスに貼ると、その提供元へ内容が送信されます。未公開原稿の扱いにご注意ください。
                  </p>
                  {copied === 'ok' && (
                    <p className="text-primary text-sm">
                      コピーしました。AI のチャットに貼り付けてください。
                    </p>
                  )}
                  {copied === 'err' && (
                    <p className="text-destructive text-sm">
                      コピーに失敗しました。ブラウザの権限をご確認ください。
                    </p>
                  )}
                </div>
              </Section>
            )}

            {format === 'bundle' && (
              <Section title="構造化データ（JSON）">
                <Note>
                  すべての作品を 1つの JSON にまとめてバックアップします。取り込みで復元できます。
                </Note>
              </Section>
            )}
          </div>
        </div>

        <DialogFooter className="border-outline-variant/30 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="text-primary"
          >
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={!canExport} className="gap-2">
            {format === 'ai' ? <Copy className="size-4" /> : <Download className="size-4" />}
            {format === 'ai' ? 'コピー' : '書き出し'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-4 border-outline-variant/30 border-b pb-2 font-serif text-lg text-primary">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md bg-surface-container-low p-4 text-on-surface-variant text-sm leading-relaxed">
      {children}
    </p>
  )
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  const text = value?.trim()
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-on-surface-variant text-xs uppercase tracking-wider">
        {label}
      </dt>
      <dd
        className={cn(
          'min-w-0 flex-1 break-words',
          text ? 'text-on-surface' : 'text-on-surface-variant/60',
        )}
      >
        {text || '未設定'}
      </dd>
    </div>
  )
}
