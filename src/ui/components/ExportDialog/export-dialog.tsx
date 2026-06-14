import { BookText, Braces, Download, Folder, Globe } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import type { Work } from '@/core/schema'
import { cn } from '@/lib/utils'
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

type Format = 'epub' | 'web' | 'folder' | 'bundle'
type Platform = 'narou' | 'kakuyomu'

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 書き出し対象。エディタは現在の作品、ライブラリは選択カードの作品。 */
  work: Work | null
  /** バンドル（全作品）用 */
  getAllWorks: () => Promise<Work[]>
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
    key: 'bundle',
    icon: Braces,
    title: '構造化データ',
    desc: 'バックアップ用の JSON データ一括出力',
    needsWork: false,
  },
]

/** 書き出しモーダル。左に形式、右に設定。core の各 exporter を配線する。 */
export function ExportDialog({ open, onOpenChange, work, getAllWorks }: ExportDialogProps) {
  const [format, setFormat] = useState<Format>('epub')
  const [platform, setPlatform] = useState<Platform>('narou')
  const [episodeId, setEpisodeId] = useState<string | null>(null)

  const episodes = work?.episodes ?? []
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0] ?? null

  const canExport =
    format === 'bundle'
      ? true
      : format === 'web'
        ? Boolean(work) && episodes.length > 0
        : Boolean(work)

  const handleExport = async () => {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
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
                  onClick={() => setFormat(key)}
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
                <Note>
                  1作品＝1冊として、縦書き EPUB を書き出します。電子書籍リーダーでそのまま読めます。
                </Note>
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
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-primary">
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={!canExport} className="gap-2">
            <Download className="size-4" />
            書き出し
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
