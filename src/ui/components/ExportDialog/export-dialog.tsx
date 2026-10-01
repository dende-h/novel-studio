import {
  BookText,
  Copy,
  Download,
  FileText,
  Folder,
  Gamepad2,
  Globe,
  Pencil,
  Sparkles,
} from 'lucide-react'
import { type ComponentType, useId, useMemo, useState } from 'react'
import { DOCX_PRESETS } from '@/core/exporter/toDocx'
import { glossaryToPlainText, workToPlainText } from '@/core/exporter/toPlainText'
import { sheetSourceOf } from '@/core/exporter/toScriptText'
import { gameAssetKey } from '@/core/game/assets'
import { DEFAULT_BG_KEY } from '@/core/game/presets'
import { mergeBackgroundCatalog, mergeBgmCatalog, mergeSeCatalog } from '@/core/game/templates'
import { dataUrlMime, decodeDataUrl } from '@/core/image'
import { MAX_SYNOPSIS_LENGTH, type Work } from '@/core/schema'
import {
  composeScriptSheet,
  DEFAULT_FRONT_MATTER,
  type SheetFrontMatter,
} from '@/core/script/layout'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
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
  workScriptDocxExport,
  workScriptTextExport,
} from '@/ui/_utils/exporters'
import { loadGameFont } from '@/ui/_utils/game-font'
import { useAuth } from '@/ui/auth/auth-context'
import { SHEET_PRESETS } from '@/ui/components/ScriptSheet/script-sheet'
import { TemplatePicker } from '@/ui/components/StagingView/template-picker'
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
import {
  loadTemplateCatalog,
  resolveTemplateBackgrounds,
  resolveTemplateBgms,
  resolveTemplateSes,
  templateBgKeysOf,
  templateBgmKeysOf,
  templateBgSrc,
  templateSeKeysOf,
  useTemplateCatalog,
} from '@/ui/game/template-catalog'
import { useIsNarrow } from '@/ui/hooks/use-narrow'

type Format = 'script' | 'epub' | 'web' | 'game' | 'folder' | 'ai'
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
  /** 持ち込み背景の置き場所（演出が指す分だけ zip に同梱される）。 */
  gameAssetRepo?: Pick<GameAssetRepository, 'list'>
  /** 演出エディタへ（指定時のみ「演出を編集」を表示。ホスト側がこのダイアログを閉じてから開く） */
  onEditStaging?: () => void
}

interface FormatDef {
  key: Format
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
  /** 作品の形式で出し分ける（脚本は提出用テキスト、小説は EPUB と投稿サイト）。 */
  only?: 'novel' | 'script'
}

const FORMATS: FormatDef[] = [
  {
    key: 'script',
    icon: FileText,
    title: '脚本（提出用）',
    desc: 'Word（縦書き 20字×20行）またはテキストで、柱・ト書き・セリフの体裁を整えて',
    only: 'script',
  },
  {
    key: 'epub',
    icon: BookText,
    title: 'EPUB / 電子書籍',
    desc: '縦書き対応の電子書籍標準フォーマット',
    only: 'novel',
  },
  {
    key: 'web',
    icon: Globe,
    title: 'Web投稿形式',
    desc: '「小説家になろう」「カクヨム」などの投稿用記法',
    only: 'novel',
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
  gameAssetRepo,
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
  // 脚本（提出用）：出力の形（Word A4／B5／テキスト）と、前付け（表紙・登場人物表・梗概）の有無。
  const [scriptOutput, setScriptOutput] = useState<'docx-a4' | 'docx-b5' | 'txt'>('docx-a4')
  const [front, setFront] = useState<SheetFrontMatter>(DEFAULT_FRONT_MATTER)
  const glossaryToggleId = useId()
  const frontIds = { cover: useId(), cast: useId(), synopsis: useId() }
  const glossaryCount = work?.glossary?.length ?? 0

  const episodes = work?.episodes ?? []
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0] ?? null
  // 形式で出せるものが変わる。選んでいた形式が無ければ先頭に寄せる（脚本なら脚本テキスト）。
  const isScript = work?.format === 'script'
  const formats = FORMATS.filter((f) => !f.only || f.only === (isScript ? 'script' : 'novel'))
  const fmt: Format = formats.some((f) => f.key === format) ? format : (formats[0]?.key ?? 'ai')
  // 登場人物表は用語集の「人物」から、梗概は作品情報の梗概から。枚数は 20字×20行換算で本文だけ数える。
  const sheetSource = useMemo(
    () => (work && isScript ? sheetSourceOf(work) : null),
    [work, isScript],
  )
  const bodySheets = useMemo(
    () =>
      sheetSource
        ? composeScriptSheet(
            sheetSource,
            { cover: false, cast: false, synopsis: false },
            SHEET_PRESETS.vertical,
          ).length
        : 0,
    [sheetSource],
  )
  const castCount = sheetSource?.cast?.length ?? 0
  const synopsisLength = Array.from(work?.synopsis?.trim() ?? '').length

  // サウンドノベルは無料枠でもアカウント必須（D-GAME-ACCOUNT）——
  // 運営素材を同梱した zip の配布には、ライセンスに同意した主体の特定が要る。
  // 判定は「構想の道具」と同じ形（loading 中に誤って解禁しない）。
  const auth = useAuth()
  const gameUnlocked = auth.status === 'free' || auth.status === 'member'
  // 既定背景の候補（目録＋組み込み）。選んでいるキーが一覧から外されていても選択は保つ
  const { backgrounds, manifest: templateManifest } = useTemplateCatalog()
  const gamePreset =
    backgrounds.find((b) => b.key === gameBg) ??
    backgrounds.find((b) => b.key === DEFAULT_BG_KEY) ??
    backgrounds[0]!
  const bgOptions = backgrounds.filter((b) => !b.hidden || b.key === gamePreset.key)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  // 作る作業（演出付け・書き出し）は PC など広い画面に限定する（D-GAME-PC）。
  // 演出エディタの入口ゲート（App.tsx の stagingAvailable）と同じ閾値。プレイは端末を問わない。
  const narrow = useIsNarrow()

  const canExport =
    fmt === 'web' || fmt === 'ai' || fmt === 'script'
      ? Boolean(work) && episodes.length > 0
      : fmt === 'game'
        ? Boolean(work) && episodes.length > 0 && gameUnlocked && !narrow
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
    if (fmt === 'ai') {
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
    if (fmt === 'game') {
      if (work && selectedEpisode && gameUnlocked) {
        setBusy(true)
        setGameError(false)
        try {
          // フォントが取れなくても書き出しは止めない（システムの明朝で動く zip になる）
          const font = await loadGameFont()
          // 保存済みの演出譜（話者・背景・場面の切れ目）があれば載せる
          const staging = await stagingRepo?.get(work.id, selectedEpisode.id)
          // テンプレ背景の画像（目録にある分）は実体を取って素材の形で渡す。取れなければ
          // tone の控え（組み込みキーは exporter が SVG を描くので何も渡さない）
          const manifest = await loadTemplateCatalog()
          const templates = await resolveTemplateBackgrounds(
            templateBgKeysOf(staging ? [staging] : [], [gameBg]),
            mergeBackgroundCatalog(manifest),
            { fallback: 'gradient' },
          )
          // 効果音の音声ファイルも同じ（取れなければ合成の控え・無ければ鳴らないだけ）
          const templateSes = await resolveTemplateSes(
            templateSeKeysOf(staging ? [staging] : []),
            mergeSeCatalog(manifest),
            { fallback: 'omit' },
          )
          // BGM も同じ（取れなければ鳴らないだけ・組み込みの控えは無い）
          const templateBgms = await resolveTemplateBgms(
            templateBgmKeysOf(staging ? [staging] : []),
            mergeBgmCatalog(manifest),
            { fallback: 'omit' },
          )
          // 持ち込み素材（背景・立ち絵）は手元の全件を渡し、使う分だけ exporter が同梱する
          const userAssets = [
            ...((await gameAssetRepo?.list()) ?? []),
            ...templates.assets,
            ...templateSes.assets,
            ...templateBgms.assets,
          ].map((a) => ({
            key: gameAssetKey(a),
            id: a.id,
            label: a.name,
            tone: a.tone,
            mime: dataUrlMime(a.dataUrl) ?? 'image/webp',
            data: decodeDataUrl(a.dataUrl),
            kind: a.kind,
            ...(a.character ? { character: a.character } : {}),
            ...(a.expression ? { expression: a.expression } : {}),
            ...(a.preset ? { preset: a.preset } : {}),
            ...(a.loopStart !== undefined ? { loopStart: a.loopStart } : {}),
            ...(a.loopEnd !== undefined ? { loopEnd: a.loopEnd } : {}),
            createdAt: a.createdAt,
          }))
          triggerDownload(
            episodeNovelGameExport(
              work,
              selectedEpisode,
              { defaultBg: gameBg, font, userAssets },
              staging,
            ),
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
      if (fmt === 'script') {
        triggerDownload(
          scriptOutput === 'txt'
            ? workScriptTextExport(work, front)
            : workScriptDocxExport(work, scriptOutput === 'docx-a4' ? 'a4' : 'b5', front),
        )
      } else if (fmt === 'epub') triggerDownload(workEpubExport(work))
      else if (fmt === 'folder') triggerDownload(workFolderZipExport(work))
      else if (fmt === 'web' && selectedEpisode) {
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
            {formats.map(({ key, icon: Icon, title, desc }) => {
              const active = fmt === key
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
            {fmt === 'script' && (
              <Section title="脚本（提出用） 設定">
                <div className="space-y-5">
                  <Note>
                    柱は行頭に ○、ト書きは 3 字下げ、セリフは話者名から（2 行目以降は 1
                    字下げ）、！？の後ろは 1 マス空け、の体裁で書き出します。Word 版は縦書き
                    20字×20行の原稿用紙設定で、柱書き・ト書き・セリフが段落スタイルになっています。ページ番号は本文の
                    1 頁目から入ります。
                  </Note>
                  <div>
                    <div className="mb-2 text-on-surface-variant text-xs uppercase tracking-wider">
                      出力
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['docx-a4', `Word ${DOCX_PRESETS.a4.label}`],
                          ['docx-b5', `Word ${DOCX_PRESETS.b5.label}`],
                          ['txt', 'テキスト（.txt）'],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={scriptOutput === key}
                          onClick={() => setScriptOutput(key)}
                          className={cn(
                            'rounded-full border px-4 py-1.5 text-sm transition-colors',
                            scriptOutput === key
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-high',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-on-surface-variant text-xs">
                      {scriptOutput === 'txt'
                        ? '折り返しのないテキストです。Word などに貼って、応募先の規定に合わせられます。'
                        : '游明朝・横置きの用紙に縦書きで組みます。応募先の規定に合わせて Word で調整できます。'}
                    </p>
                  </div>
                  <div className="space-y-2 rounded-md border border-outline-variant/30 p-3">
                    {(
                      [
                        [
                          'cover',
                          '表紙（題名・著者名）',
                          work?.author ? work.author : '著者名は作品情報で設定',
                        ],
                        [
                          'cast',
                          scriptOutput === 'txt' ? '登場人物表' : '人物一覧表',
                          castCount > 0
                            ? `用語集の「人物」${castCount} 件（名前と説明）を載せます`
                            : '用語集に「人物」の項目がないので付きません',
                        ],
                        [
                          'synopsis',
                          scriptOutput === 'txt'
                            ? '梗概（結末までのあらすじ）'
                            : 'あらすじ（梗概・結末まで）',
                          synopsisLength > 0
                            ? `作品情報の梗概 ${synopsisLength} 字を載せます（目安は 400〜${MAX_SYNOPSIS_LENGTH} 字）`
                            : '作品情報に梗概がないので付きません',
                        ],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <div key={key} className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor={frontIds[key]}
                          className="font-normal text-on-surface text-sm"
                        >
                          {label}
                          <span className="mt-0.5 block text-on-surface-variant text-xs">
                            {hint}
                          </span>
                        </Label>
                        <Switch
                          id={frontIds[key]}
                          checked={front[key]}
                          onCheckedChange={(v) => setFront((f) => ({ ...f, [key]: v }))}
                        />
                      </div>
                    ))}
                  </div>
                  <dl className="space-y-2 rounded-md border border-outline-variant/30 p-4 text-sm">
                    <MetaRow label="タイトル" value={work?.title} />
                    <MetaRow label="著者" value={work?.author} />
                    <MetaRow label="枚数" value={`本文 ${bodySheets} 枚（20字×20行換算）`} />
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

            {fmt === 'epub' && (
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

            {fmt === 'web' && (
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

            {fmt === 'game' && narrow && (
              <Section title="サウンドノベル 設定">
                <Note>
                  サウンドノベルづくり（演出付けと書き出し）は、PC などの広い画面での機能です。
                  書き出したゲームは、スマートフォンでも遊べます。
                </Note>
              </Section>
            )}

            {fmt === 'game' &&
              !narrow &&
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
                        {bgOptions.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 text-primary"
                        onClick={() => setBgPickerOpen(true)}
                      >
                        テンプレから選ぶ
                      </Button>
                      <TemplatePicker
                        open={bgPickerOpen}
                        onOpenChange={setBgPickerOpen}
                        kind="bg"
                        items={backgrounds}
                        manifest={templateManifest}
                        selectedKey={gamePreset.key}
                        onPick={(bg) => setGameBg(bg.key)}
                      />
                      <img
                        src={templateBgSrc(gamePreset)}
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

            {fmt === 'folder' && (
              <Section title="フォルダ(ZIP) 設定">
                <Note>
                  話ごとのテキストファイルをフォルダ構成のまま ZIP にまとめて書き出します。
                </Note>
              </Section>
            )}

            {fmt === 'ai' && (
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
            {fmt === 'ai' ? <Copy className="size-4" /> : <Download className="size-4" />}
            {fmt === 'ai' ? 'コピー' : busy ? '書き出し中…' : '書き出し'}
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
