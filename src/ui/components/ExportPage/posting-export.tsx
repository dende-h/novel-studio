import { Download, ScanText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { blocksToNotation } from '@/core/exporter/blocksToNotation'
import { postingDocx } from '@/core/exporter/posting-docx'
import {
  DEFAULT_POSTING_TEXT_FORMAT,
  encodePostingText,
  episodeTxtName,
  importedIllustrationsZip,
  type PostingTextFormat,
  postingEpisodeBytes,
  safePostingName,
} from '@/core/exporter/posting-files'
import { type PostingOptions, toPostingSite } from '@/core/exporter/toPostingSite'
import type { Work } from '@/core/schema'
import { POSTING_PROFILES, type PostingSiteId, postingProfile } from '@/core/sites/portability'
import { copyText } from '@/ui/_utils/clipboard'
import { triggerDownload } from '@/ui/_utils/download'
import { FieldHelp } from '@/ui/components/FieldHelp/field-help'
import {
  PostingWarnings,
  postingSites,
  selectClass,
} from '@/ui/components/TextImportDialog/posting-preview'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/components/ui/dialog'

export function PostingDestination({
  site,
  onChange,
  stacked = false,
}: {
  site: PostingSiteId
  stacked?: boolean
  onChange: (site: PostingSiteId) => void
}) {
  return (
    <label className={stacked ? 'grid gap-1 text-sm' : 'flex flex-wrap items-center gap-2 text-sm'}>
      投稿先
      <select
        value={site}
        className={selectClass + ' min-w-0 max-w-full'}
        onChange={(event) => onChange(event.target.value as PostingSiteId)}
      >
        {postingSites.map(([id, { label }]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function PostingFormat({
  format,
  setFormat,
  site,
}: {
  format: PostingTextFormat
  setFormat: (format: PostingTextFormat) => void
  site: PostingSiteId
}) {
  const extended = site === 'akatsuki' || site === 'narou' || site === 'alphapolis'
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        文字コード
        <select
          className={selectClass}
          value={format.encoding}
          onChange={(event) =>
            setFormat({ ...format, encoding: event.target.value as PostingTextFormat['encoding'] })
          }
        >
          <option value="utf-8">UTF-8</option>
          {extended && <option value="shift_jis">Shift_JIS</option>}
          {extended && site !== 'alphapolis' && <option value="euc-jp">EUC-JP</option>}
          {site === 'narou' && <option value="iso-2022-jp">JIS（ISO-2022-JP）</option>}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        改行
        <select
          className={selectClass}
          value={format.newline}
          onChange={(event) =>
            setFormat({ ...format, newline: event.target.value as PostingTextFormat['newline'] })
          }
        >
          <option value="lf">LF</option>
          <option value="crlf">CRLF</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={format.encoding === 'utf-8' && format.bom}
          disabled={format.encoding !== 'utf-8'}
          onChange={(event) => setFormat({ ...format, bom: event.target.checked })}
        />
        BOMを付ける
      </label>
    </div>
  )
}

export function PostingOptionsControl({
  site,
  options,
  onChange,
  showIllustrationMarker = true,
  showImageOptions = true,
}: {
  site: PostingSiteId
  options: PostingOptions
  onChange: (options: PostingOptions) => void
  showIllustrationMarker?: boolean
  showImageOptions?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-3 text-sm empty:hidden">
      {showIllustrationMarker && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={options.illustrations === 'markers'}
            onChange={(event) =>
              onChange({ ...options, illustrations: event.target.checked ? 'markers' : 'list' })
            }
          />
          本文に挿絵の目印を入れる
        </label>
      )}
      {showImageOptions && site === 'pixiv' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(options.pixivOriginalWork)}
            onChange={(event) => onChange({ ...options, pixivOriginalWork: event.target.checked })}
          />
          同じ作品を更新する（アップロード済みの挿絵IDを使う）
        </label>
      )}
      {showImageOptions && (site === 'narou' || site === 'akatsuki') && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(options.registeredImageIds)}
            onChange={(event) => onChange({ ...options, registeredImageIds: event.target.checked })}
          />
          出所不明の挿絵タグには、この投稿先で登録したIDを使っている
        </label>
      )}
      {postingProfile(site).dots === 'ruby' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(options.plainEmphasis)}
            onChange={(event) => onChange({ ...options, plainEmphasis: event.target.checked })}
          />
          傍点を外す
        </label>
      )}
    </div>
  )
}

const postingPreferences = z.object({
  site: z.custom<PostingSiteId>(
    (value) => typeof value === 'string' && Object.hasOwn(POSTING_PROFILES, value),
  ),
  episodeId: z.string(),
  saveAs: z.enum(['txt', 'docx']),
  format: z.object({
    encoding: z.enum(['utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp']),
    newline: z.enum(['lf', 'crlf']),
    bom: z.boolean(),
  }),
  options: z.object({
    pixivOriginalWork: z.boolean().optional(),
    registeredImageIds: z.boolean().optional(),
    plainEmphasis: z.boolean().optional(),
  }),
})

type PostingPreferences = z.infer<typeof postingPreferences>

function readPreferences(key: string, initialEpisode?: string): PostingPreferences {
  const fallback: PostingPreferences = {
    site: 'narou',
    episodeId: '',
    saveAs: 'txt',
    format: DEFAULT_POSTING_TEXT_FORMAT,
    options: {},
  }
  let saved = fallback
  try {
    const parsed = postingPreferences.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'))
    if (parsed.success) saved = parsed.data
  } catch {
    // 保存した設定が読めない環境では標準設定を使う。
  }
  return { ...saved, episodeId: initialEpisode ?? saved.episodeId }
}

export function PostingExport({
  work,
  initialEpisode,
  onEditEpisode,
}: {
  work: Work
  initialEpisode?: string
  onEditEpisode?: (id: string) => void
}) {
  const key = 'ns-posting-export:' + work.id
  const [preferences, setPreferences] = useState(() => readPreferences(key, initialEpisode))
  const [previewOpen, setPreviewOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [previewStatus, setPreviewStatus] = useState('')
  const [error, setError] = useState('')
  const { site, episodeId, saveAs, format, options } = preferences
  const profile = postingProfile(site)
  const episode = work.episodes.find((item) => item.id === episodeId) ?? work.episodes[0]
  const asTxt = saveAs === 'txt'
  const result = useMemo(
    () => (episode ? toPostingSite(episode.blocks, site, options) : null),
    [episode, site, options],
  )
  const needsReview = Boolean(result?.warnings.some((warning) => warning.needsReview))
  // 本文・投稿先・書式が変わったときの確認は保持しない。
  const [reviewedResult, setReviewedResult] = useState<typeof result>(null)
  const canExport = Boolean(result && (!needsReview || reviewedResult === result))

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(preferences))
    } catch {
      // 書き出し自体はストレージ保存に依存しない。
    }
  }, [key, preferences])

  function update(changes: Partial<PostingPreferences>) {
    setPreferences((current) => ({ ...current, ...changes }))
    setReviewedResult(null)
    setStatus('')
    setPreviewStatus('')
    setError('')
  }

  let bytes: number | undefined
  let encodingError = ''
  if (asTxt && result) {
    try {
      bytes = encodePostingText(result.text, format).length
    } catch (cause) {
      encodingError = cause instanceof Error ? cause.message : '文字コードを変換できません'
    }
  }
  const limited = profile.maxBytes !== undefined && bytes !== undefined && bytes > profile.maxBytes

  async function copy(value: string, inPreview = false) {
    setError('')
    const ok = await copyText(value)
    const message = ok
      ? 'コピーしました'
      : 'コピーできませんでした。本文を選択してコピーしてください'
    if (inPreview) setPreviewStatus(message)
    else setStatus(message)
  }

  function download(filename: string, mime: string, data: () => Uint8Array | string) {
    setError('')
    try {
      triggerDownload({ filename, mime, data: data() })
      setStatus('書き出しました')
    } catch (cause) {
      setStatus('')
      setError(cause instanceof Error ? cause.message : '書き出せませんでした')
    }
  }

  const guide =
    site === 'estar'
      ? '新しい作品を作るときは、ブラウザ版の「作品をインポート」で、この話のTXTを読み込めます。'
      : site === 'noveldays'
        ? 'NOVEL DAYSの一般小説記法で保存します。'
        : profile.txt
          ? '投稿画面の「ファイルをアップロード」でTXTを読み込めます。'
          : '投稿先の画面に、話ごとに本文を貼り付けます。'

  return (
    <Dialog
      open={previewOpen}
      onOpenChange={(open) => {
        setPreviewStatus('')
        setPreviewOpen(open)
      }}
    >
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <section className="space-y-3 rounded-lg border border-border bg-surface-container-lowest p-4">
          <h2 className="font-serif text-lg text-primary">投稿先と話を選ぶ</h2>
          <PostingDestination
            stacked
            site={site}
            onChange={(next) =>
              update({ site: next, format: DEFAULT_POSTING_TEXT_FORMAT, options: {} })
            }
          />
          {episode ? (
            <label className="grid gap-1 text-sm">
              確認する話
              <select
                className={selectClass}
                value={episode.id}
                onChange={(event) => update({ episodeId: event.target.value })}
              >
                {work.episodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-on-surface-variant text-sm">書き出せる話がありません。</p>
          )}
          <p className="text-on-surface-variant text-sm">{guide}</p>
          <PostingOptionsControl
            site={site}
            options={options}
            onChange={(next) => update({ options: next })}
            showIllustrationMarker={false}
            showImageOptions={Boolean(result?.illustrations.length)}
          />
        </section>
        {episode && result && (
          <div className="min-w-0 space-y-4">
            <section className="space-y-3 rounded-lg border border-border bg-surface-container-lowest p-4">
              <h2 className="font-serif text-lg text-primary">投稿用の本文</h2>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTrigger asChild>
                  <Button size="sm">
                    <ScanText aria-hidden />
                    書き出す本文を確認
                  </Button>
                </DialogTrigger>
                {onEditEpisode && (
                  <Button size="sm" variant="ghost" onClick={() => onEditEpisode(episode.id)}>
                    この話の本文を直す
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-on-surface-variant text-sm">
                <span>
                  {result.characters.toLocaleString('ja-JP')}文字
                  {bytes !== undefined &&
                    ' ／ TXTの大きさ ' + bytes.toLocaleString('ja-JP') + ' バイト'}
                  {asTxt &&
                    profile.maxBytes &&
                    '（上限 ' + profile.maxBytes.toLocaleString('ja-JP') + ' バイト）'}
                  {profile.guideChars &&
                    ' ／ 1話 ' + profile.guideChars.toLocaleString('ja-JP') + '文字が目安'}
                </span>
                {asTxt && (
                  <FieldHelp
                    title="TXTの大きさ"
                    description="TXTファイルの大きさを、バイト（B）で表示します。"
                  >
                    <p>
                      同じ文字数でも、日本語・絵文字・改行などによってファイルの大きさは変わります。
                    </p>
                    <p>投稿先にファイルの大きさの上限があるときに使います。</p>
                  </FieldHelp>
                )}
              </div>
              {needsReview && !canExport && (
                <p className="text-sm">
                  変換で確認が必要な箇所があります。「書き出す本文を確認」から確認してください。
                </p>
              )}
              <div className="space-y-2 border-t border-border pt-3">
                <h3 className="font-medium text-sm">投稿画面に貼り付ける</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canExport}
                    onClick={() => void copy(result.text)}
                  >
                    本文をコピー
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void copy(work.title)}>
                    作品名をコピー
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void copy(episode.title)}>
                    話タイトルをコピー
                  </Button>
                  {work.description && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copy(work.description ?? '')}
                    >
                      紹介文をコピー
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-sm">
                    保存形式
                    <select
                      className={selectClass}
                      value={saveAs}
                      onChange={(event) =>
                        update({ saveAs: event.target.value === 'docx' ? 'docx' : 'txt' })
                      }
                    >
                      <option value="txt">TXT（テキスト）</option>
                      <option value="docx">Word（.docx）</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant={asTxt && profile.txt ? 'default' : 'outline'}
                    disabled={!canExport || Boolean(encodingError) || limited}
                    onClick={() => {
                      if (asTxt) {
                        download(episodeTxtName(episode), 'text/plain', () =>
                          postingEpisodeBytes(result, site, format),
                        )
                      } else {
                        download(
                          safePostingName(episode.title) + '.docx',
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                          () => postingDocx(result.text),
                        )
                      }
                    }}
                  >
                    <Download aria-hidden />
                    この話を保存
                  </Button>
                </div>
                {asTxt ? (
                  <details className="text-sm">
                    <summary className="rounded py-1 text-primary">TXTの細かい設定</summary>
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-1 text-on-surface-variant">
                        投稿先から指定があったときに変更します。
                        <FieldHelp
                          title="TXTの細かい設定"
                          description="普段は標準の設定で使えます。"
                        >
                          <p>
                            <strong>文字コード</strong>
                            は文字をファイルに記録する決まりです。標準はUTF-8です。
                          </p>
                          <p>
                            <strong>改行の種類</strong>
                            は行の切れ目をファイルに記録する方法です。標準はLFです。
                          </p>
                          <p>
                            <strong>BOM</strong>
                            はファイルの先頭に付ける目印です。投稿先で求められたときに付けます。
                          </p>
                        </FieldHelp>
                      </div>
                      <PostingFormat
                        format={format}
                        setFormat={(next) => update({ format: next })}
                        site={site}
                      />
                    </div>
                  </details>
                ) : (
                  <p className="text-on-surface-variant text-sm">
                    投稿先に合わせた本文を、Wordで開けるファイルにします。
                  </p>
                )}
                {encodingError && (
                  <p role="alert" className="text-destructive text-sm">
                    {encodingError}
                  </p>
                )}
                {limited && (
                  <p role="alert" className="text-destructive text-sm">
                    投稿先のTXTファイルの上限を超えています。
                  </p>
                )}
              </div>
              {status && (
                <p role="status" className="text-primary text-sm">
                  {status}
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
            </section>
            {result.illustrations.length > 0 && (
              <section className="space-y-3 rounded-lg border border-border bg-surface-container-lowest p-4">
                <h2 className="font-serif text-lg text-primary">
                  元の原稿の挿絵（{result.illustrations.length}件）
                </h2>
                <ul className="space-y-3 text-sm">
                  {result.illustrations.map((ref) => {
                    const previous =
                      ref.line > 1
                        ? blocksToNotation(episode.blocks.slice(ref.line - 2, ref.line - 1)).trim()
                        : ''
                    const asset = work.manuscriptImport?.assets.find(
                      ({ path }) => path === (ref.assetPath ?? ref.name),
                    )
                    return (
                      <li key={ref.line + '-' + ref.column} className="space-y-1">
                        <p className="font-medium">
                          {ref.disposition === 'keep'
                            ? '投稿先で使える挿絵の指定を本文に残します'
                            : '元の位置をメモに残します'}
                        </p>
                        <p className="text-on-surface-variant">
                          {ref.disposition === 'keep'
                            ? '投稿先のプレビューで画像が表示されるか確認してください。'
                            : site === 'kakuyomu'
                              ? 'カクヨム用の本文とは別に、元の場所を確認できます。'
                              : '投稿先で画像を入れられるときは、次の場所を目安にしてください。'}
                        </p>
                        <div className="border-outline-variant/30 border-l-2 pl-2 text-on-surface-variant">
                          <p className="break-all">
                            元の位置　{ref.line}行目　{ref.name}
                          </p>
                          {previous && (
                            <p className="wrap-anywhere">
                              「{previous.slice(0, 64)}
                              {previous.length > 64 ? '…' : ''}」のあと
                            </p>
                          )}
                        </div>
                        {asset && (
                          <img
                            className="max-h-36 max-w-full rounded"
                            alt={ref.name}
                            src={asset.image}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
                {result.illustrations.some((ref) => ref.disposition === 'replace') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      download('挿絵の位置.txt', 'text/plain;charset=utf-8', () =>
                        result.illustrations
                          .map((ref) => ref.line + '行目　' + ref.name)
                          .join('\n'),
                      )
                    }
                  >
                    挿絵の位置メモを保存
                  </Button>
                )}
              </section>
            )}
            {(work.manuscriptImport?.notes || Boolean(work.manuscriptImport?.assets.length)) && (
              <details className="rounded-lg border border-border bg-surface-container-lowest p-4 text-sm">
                <summary className="text-primary">取り込んだ原稿の資料</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {work.manuscriptImport?.notes && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        download(
                          '取込情報.txt',
                          'text/plain;charset=utf-8',
                          () => work.manuscriptImport?.notes ?? '',
                        )
                      }
                    >
                      取込情報をTXTで保存
                    </Button>
                  )}
                  {Boolean(work.manuscriptImport?.assets.length) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        download('挿絵と位置.zip', 'application/zip', () =>
                          importedIllustrationsZip(work),
                        )
                      }
                    >
                      挿絵と位置をZIPで保存
                    </Button>
                  )}
                </div>
              </details>
            )}
            <DialogContent className="w-[calc(100%-2rem)] gap-3 px-4 pt-4 sm:max-w-3xl sm:px-6 lg:max-w-5xl">
              <DialogHeader className="pr-7 text-left">
                <DialogTitle className="font-serif text-primary">
                  投稿先に貼り付ける本文
                </DialogTitle>
                <DialogDescription>
                  {profile.label} · {episode.title}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="mx-0 gap-3 px-0">
                <pre className="wrap-anywhere rounded-md border bg-surface-container-low px-4 py-3 font-sans text-sm leading-7 whitespace-pre-wrap">
                  {result.text}
                </pre>
                <PostingWarnings result={result} />
                {needsReview && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewedResult === result}
                      onChange={(event) => setReviewedResult(event.target.checked ? result : null)}
                    />
                    警告のある箇所は、表示どおりに書き出す
                  </label>
                )}
              </DialogBody>
              <DialogFooter className="mx-0 mb-0 flex-row flex-wrap items-center justify-between px-0 pb-0">
                {onEditEpisode && (
                  <Button variant="ghost" onClick={() => onEditEpisode(episode.id)}>
                    この話の本文を直す
                  </Button>
                )}
                {previewStatus && (
                  <p role="status" className="text-sm">
                    {previewStatus}
                  </p>
                )}
                <Button disabled={!canExport} onClick={() => void copy(result.text, true)}>
                  本文をコピー
                </Button>
              </DialogFooter>
            </DialogContent>
          </div>
        )}
      </div>
    </Dialog>
  )
}
