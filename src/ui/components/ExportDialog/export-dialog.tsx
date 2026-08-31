import { BookText, Copy, Download, Folder, Gamepad2, Globe, Pencil, Sparkles } from 'lucide-react'
import { type ComponentType, useId, useState } from 'react'
import { glossaryToPlainText, workToPlainText } from '@/core/exporter/toPlainText'
import {
  DEFAULT_BG_KEY,
  PRESET_BACKGROUNDS,
  presetBackground,
  presetBgSvg,
} from '@/core/game/presets'
import type { Work } from '@/core/schema'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { cn } from '@/lib/utils'
import { copyText } from '@/ui/_utils/clipboard'
import { triggerDownload } from '@/ui/_utils/download'
import {
  episodeKakuyomuExport,
  episodeNarouExport,
  episodeNovelGameExport,
  workAiTextExport,
  workEpubExport,
  workFolderZipExport,
} from '@/ui/_utils/exporters'
import { loadGameFont } from '@/ui/_utils/game-font'
import { useAuth } from '@/ui/auth/auth-context'
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

type Format = 'epub' | 'web' | 'game' | 'folder' | 'ai'
type Platform = 'narou' | 'kakuyomu'

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 書き出し対象。エディタは現在の作品、ライブラリは選択カードの作品。 */
  work: Work | null
  /** EPUB メタ情報を編集（指定時のみ「作品情報を編集」を表示） */
  onEditMeta?: () => void
  /** 保存済みの演出譜（サウンドノベル用）。渡されたときだけ書き出しに演出が載る。 */
  stagingRepo?: Pick<StagingRepository, 'get'>
  /** 演出エディタへ（指定時のみ「演出を編集」を表示。ホスト側がこのダイアログを閉じてから開く） */
  onEditStaging?: () => void
}

interface FormatDef {
  key: Format
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
}

const FORMATS: FormatDef[] = [
  {
    key: 'epub',
    icon: BookText,
    title: 'EPUB / 電子書籍',
    desc: '縦書き対応の電子書籍標準フォーマット',
  },
  {
    key: 'web',
    icon: Globe,
    title: 'Web投稿形式',
    desc: '「小説家になろう」「カクヨム」などの投稿用記法',
  },
  {
    key: 'game',
    icon: Gamepad2,
    title: 'サウンドノベル',
    desc: 'ブラウザでそのまま遊べるゲーム形式（ZIP）',
  },
  {
    key: 'folder',
    icon: Folder,
    title: 'フォルダ(ZIP)',
    desc: '話ごとのテキストをまとめて書き出し',
  },
  {
    key: 'ai',
    icon: Sparkles,
    title: 'AI に渡す',
    desc: 'ChatGPT・Gemini などに読ませる（コピー / ファイル）',
  },
]

/** 書き出しモーダル。左に形式、右に設定。core の各 exporter を配線する。 */
export function ExportDialog({
  open,
  onOpenChange,
  work,
  onEditMeta,
  stagingRepo,
  onEditStaging,
}: ExportDialogProps) {
  const [format, setFormat] = useState<Format>('epub')
  const [platform, setPlatform] = useState<Platform>('narou')
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'err' | null>(null)
  const [includeGlossary, setIncludeGlossary] = useState(false)
  const [gameBg, setGameBg] = useState(DEFAULT_BG_KEY)
  const [busy, setBusy] = useState(false)
  const [gameError, setGameError] = useState(false)
  const glossaryToggleId = useId()
  const glossaryCount = work?.glossary?.length ?? 0

  const episodes = work?.episodes ?? []
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0] ?? null

  // サウンドノベルは無料枠でもアカウント必須（D-GAME-ACCOUNT）——
  // 運営素材を同梱した zip の配布には、ライセンスに同意した主体の特定が要る。
  // 判定は「構想の道具」と同じ形（loading 中に誤って解禁しない）。
  const auth = useAuth()
  const gameUnlocked = auth.status === 'free' || auth.status === 'member'
  const gamePreset = presetBackground(gameBg) ?? PRESET_BACKGROUNDS[0]!

  const canExport =
    format === 'web' || format === 'ai'
      ? Boolean(work) && episodes.length > 0
      : format === 'game'
        ? Boolean(work) && episodes.length > 0 && gameUnlocked
        : Boolean(work)

  // ダイアログを閉じるときはコピー結果メッセージをリセット
  const handleOpenChange = (next: boolean) => {
    if (!next) setCopied(null)
    onOpenChange(next)
  }

  // 長編はコピペだと途中で切れるため、同じ本文を .txt に保存し ChatGPT/Gemini へ添付できるようにする。
  const saveAiFile = () => {
    if (work) triggerDownload(workAiTextExport(work, includeGlossary))
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
    if (format === 'game') {
      if (work && selectedEpisode && gameUnlocked) {
        setBusy(true)
        setGameError(false)
        try {
          // フォントが取れなくても書き出しは止めない（システムの明朝で動く zip になる）
          const font = await loadGameFont()
          // 保存済みの演出譜（話者・背景・場面の切れ目）があれば載せる
          const staging = await stagingRepo?.get(work.id, selectedEpisode.id)
          triggerDownload(
            episodeNovelGameExport(work, selectedEpisode, { defaultBg: gameBg, font }, staging),
          )
        } catch {
          // 原稿は失われていない。ダイアログを開いたままメッセージを見せる
          setGameError(true)
          return
        } finally {
          setBusy(false)
        }
        onOpenChange(false)
      }
      return
    }
    if (work) {
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
          <DialogDescription>{work?.title ?? 'プロジェクト'}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden md:flex-row">
          {/* 形式リスト */}
          <nav className="flex shrink-0 flex-col gap-2 border-outline-variant/30 border-b bg-surface-container-low p-4 md:w-1/3 md:overflow-y-auto md:border-r md:border-b-0">
            {FORMATS.map(({ key, icon: Icon, title, desc }) => {
              const active = format === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFormat(key)
                    setCopied(null)
                    setGameError(false)
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
          <div className="min-h-0 flex-1 overflow-y-auto p-6 font-sans">
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
                          {p === 'narou' ? '小説家になろう' : 'カクヨム'}
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
                      className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-base text-on-surface outline-none focus:border-primary md:text-sm"
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

            {format === 'game' &&
              (gameUnlocked ? (
                <Section title="サウンドノベル 設定">
                  <div className="space-y-5">
                    <Note>
                      選んだ1話を、ブラウザで遊べるサウンドノベルにして ZIP で書き出します。
                      文字送りとオート・スキップ・ログ・セーブ、読んだ一文を画像で共有できる「一行カード」つき。
                      ZIP を展開して index.html をひらけば、そのまま読み始められます。
                    </Note>
                    <div>
                      <label
                        htmlFor="export-game-episode"
                        className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                      >
                        話を選択
                      </label>
                      <select
                        id="export-game-episode"
                        value={selectedEpisode?.id ?? ''}
                        onChange={(e) => setEpisodeId(e.target.value)}
                        className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-base text-on-surface outline-none focus:border-primary md:text-sm"
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
                    <div>
                      <label
                        htmlFor="export-game-bg"
                        className="mb-2 block text-on-surface-variant text-xs uppercase tracking-wider"
                      >
                        背景
                      </label>
                      <select
                        id="export-game-bg"
                        value={gamePreset.key}
                        onChange={(e) => setGameBg(e.target.value)}
                        className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-base text-on-surface outline-none focus:border-primary md:text-sm"
                      >
                        {PRESET_BACKGROUNDS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <img
                        src={`data:image/svg+xml;utf8,${encodeURIComponent(presetBgSvg(gamePreset))}`}
                        alt={`背景プレビュー: ${gamePreset.label}`}
                        className="mt-3 aspect-video w-full rounded-md border border-outline-variant/30 object-cover"
                      />
                    </div>
                    {onEditStaging ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant/30 p-3">
                        <p className="text-on-surface-variant text-xs leading-relaxed">
                          話者・背景・場面の切れ目を付けてあれば、その演出で書き出します。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onEditStaging}
                          className="shrink-0 gap-2 text-primary"
                        >
                          <Pencil className="size-4" />
                          演出を編集
                        </Button>
                      </div>
                    ) : null}
                    <p className="rounded-md border border-outline-variant/30 p-3 text-on-surface-variant text-xs leading-relaxed">
                      背景とフォントはコトノハの標準素材です。クレジット表記はゲーム内に自動で入り、ZIP
                      は素材ごと配布できます。
                    </p>
                    {gameError && (
                      <p className="text-destructive text-sm">
                        書き出しに失敗しました。もう一度お試しください。
                      </p>
                    )}
                  </div>
                </Section>
              ) : (
                <Section title="サウンドノベル 設定">
                  {auth.status === 'loading' ? (
                    <Note>アカウントの状態を確認しています…</Note>
                  ) : (
                    <div className="space-y-4">
                      <Note>
                        サウンドノベルの書き出しには、無料のアカウント登録が必要です。書き出す ZIP
                        にはコトノハの背景素材とフォントが同梱され、そのまま配布できます。素材のライセンスに同意した方を特定するため、サインインをお願いしています。
                      </Note>
                      {auth.available && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={auth.openSignIn}
                          className="gap-2 text-primary"
                        >
                          サインイン
                        </Button>
                      )}
                      <p className="text-on-surface-variant text-xs">
                        ほかの書き出し（EPUB・Web投稿形式・フォルダ・AI
                        に渡す）は、サインインなしで使えます。
                      </p>
                    </div>
                  )}
                </Section>
              ))}

            {format === 'folder' && (
              <Section title="フォルダ(ZIP) 設定">
                <Note>
                  話ごとのテキストファイルをフォルダ構成のまま ZIP にまとめて書き出します。
                </Note>
              </Section>
            )}

            {format === 'ai' && (
              <Section title="AI に渡す">
                <div className="space-y-4">
                  <Note>
                    作品全体をプレーンテキストにして、ChatGPT・Gemini・Claude
                    などに読ませ、感想・推敲・要約などを頼めます。ルビは「親文字（よみ）」、@参照は名前に展開されます。
                    <span className="mt-2 block">
                      <strong>短い作品</strong>は「コピー」してチャットに貼り付け。
                      <strong>長い作品</strong>はコピペだと途中で切れることがあるので、
                      <strong>ファイルに保存</strong>して、ChatGPT / Gemini
                      の「＋（ファイル添付）」からアップロードするのが確実です。
                    </span>
                  </Note>
                  {glossaryCount > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant/30 p-3">
                      <Label
                        htmlFor={glossaryToggleId}
                        className="font-normal text-on-surface text-sm"
                      >
                        登録した用語集も一緒に渡す
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveAiFile}
                    disabled={!canExport}
                    className="w-full gap-2 text-primary"
                  >
                    <Download className="size-4" />
                    ファイルに保存（アップロード用 .txt）
                  </Button>
                  <p className="rounded-md border border-outline-variant/30 p-3 text-on-surface-variant text-xs leading-relaxed">
                    ※ 本文を AI
                    サービスに渡すと、その提供元へ内容が送信されます。未公開原稿の扱いにご注意ください。
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
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 border-outline-variant/30 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="text-primary"
          >
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={!canExport || busy} className="gap-2">
            {format === 'ai' ? <Copy className="size-4" /> : <Download className="size-4" />}
            {format === 'ai' ? 'コピー' : busy ? '書き出し中…' : '書き出し'}
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
