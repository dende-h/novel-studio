import '@fontsource-variable/noto-sans-jp'
import '@fontsource-variable/noto-serif-jp'
import { useId, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  DEFAULT_POSTING_TEXT_FORMAT,
  encodePostingText,
  postingEpisodeBytes,
} from '@/core/exporter/posting-files'
import { type PostingOptions, toPostingSite } from '@/core/exporter/toPostingSite'
import { parseExternalNotation } from '@/core/importer/site-notation'
import {
  looksLikeText,
  MAX_IMPORT_BYTES,
  normalizeImportedText,
  readManuscriptText,
  textBytes,
} from '@/core/importer/text'
import { type PostingSiteId, postingProfile, type SourceNotation } from '@/core/sites/portability'
import { copyText } from '@/ui/_utils/clipboard'
import { triggerDownload } from '@/ui/_utils/download'
import { handoffNotation } from '@/ui/_utils/notation-handoff'
import {
  PostingDestination,
  PostingFormat,
  PostingOptionsControl,
} from '@/ui/components/ExportDialog/posting-export'
import {
  IllustrationList,
  NotationSelect,
  PostingWarnings,
} from '@/ui/components/TextImportDialog/posting-preview'
import { Button } from '@/ui/components/ui/button'
import { Textarea } from '@/ui/components/ui/textarea'
import './index.css'

function Converter() {
  const fieldId = useId()
  const [text, setText] = useState('')
  const [source, setSource] = useState<SourceNotation>('auto')
  const [site, setSite] = useState<PostingSiteId>('kakuyomu')
  const [format, setFormat] = useState(DEFAULT_POSTING_TEXT_FORMAT)
  const [options, setOptions] = useState<PostingOptions>({})
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [invalidFile, setInvalidFile] = useState(false)
  const [status, setStatus] = useState('')
  const valid = text.trim() && textBytes(text) <= MAX_IMPORT_BYTES && looksLikeText(text)
  const result = useMemo(
    () =>
      valid
        ? toPostingSite(parseExternalNotation(normalizeImportedText(text), source), site, options)
        : null,
    [valid, text, source, site, options],
  )
  const review = result?.warnings.some((warning) => warning.needsReview)
  let bytes: number | undefined
  let encodingError = ''
  if (result) {
    try {
      bytes = encodePostingText(result.text, format).length
    } catch (cause) {
      encodingError = cause instanceof Error ? cause.message : '文字コードを変換できません'
    }
  }
  const limit = postingProfile(site).maxBytes
  const tooLarge = bytes !== undefined && limit !== undefined && bytes > limit

  function updateText(value: string) {
    setText(value)
    setError('')
    setInvalidFile(false)
    setStatus('')
    setConfirmed(false)
  }

  async function openFile(file: File) {
    setLoading(true)
    setError('')
    try {
      if (!/\.txt$/i.test(file.name) || file.size > MAX_IMPORT_BYTES)
        throw new Error('20 MBまでのTXTを選んでください')
      updateText(readManuscriptText(new Uint8Array(await file.arrayBuffer())))
    } catch (cause) {
      setInvalidFile(true)
      setError(
        `${file.name} — ${cause instanceof Error ? cause.message : 'ファイルを読み込めません'}`,
      )
    } finally {
      setLoading(false)
    }
  }

  const ready = result && !loading && !invalidFile && (!review || confirmed)
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-on-surface sm:px-8 sm:py-9">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-outline-variant/40 pb-5">
          <a href="/lp/" className="text-sm text-primary underline-offset-4 hover:underline">
            コトノハ-leaf-
          </a>
          <h1 className="mt-2 font-serif text-2xl font-semibold sm:text-3xl">
            小説のルビ・傍点 記法変換
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            貼り付けた本文を投稿先の記法に変換します。ログインは不要で、原稿はブラウザ内で処理します。
          </p>
        </header>
        <div className="grid gap-5 lg:grid-cols-2">
          <section
            className="min-w-0 space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 sm:p-5"
            aria-label="元の原稿"
          >
            <label htmlFor={`${fieldId}-input`} className="block font-medium">
              元の本文
              <Textarea
                id={`${fieldId}-input`}
                rows={15}
                className="mt-2 font-serif leading-7"
                placeholder="ここに原稿を貼り付けます。"
                value={text}
                disabled={loading || running}
                onChange={(event) => updateText(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              TXTを開く
              <input
                className="ml-2 max-w-full"
                type="file"
                accept=".txt"
                disabled={loading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) void openFile(file)
                }}
              />
            </label>
            <NotationSelect
              value={source}
              onChange={(value) => {
                setSource(value)
                setConfirmed(false)
              }}
            />
            {!valid && text.trim() ? (
              <p role="alert" className="text-sm text-destructive">
                20 MBまでの原稿を入力し、読み込めない文字を除いてください。
              </p>
            ) : null}
            <Button
              variant="outline"
              disabled={!valid || loading || invalidFile || running}
              onClick={async () => {
                setRunning(true)
                setError('')
                try {
                  await handoffNotation(text, source)
                  window.location.assign('/')
                } catch {
                  setError(
                    '原稿を引き継げませんでした。ブラウザでデータを保存できるか確認してください',
                  )
                  setRunning(false)
                }
              }}
            >
              {running ? '原稿を引き継ぎ中…' : 'この原稿で書き始める'}
            </Button>
          </section>
          <section
            className="min-w-0 space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 sm:p-5"
            aria-label="投稿用の本文"
          >
            <PostingDestination
              site={site}
              onChange={(value) => {
                setSite(value)
                setFormat(DEFAULT_POSTING_TEXT_FORMAT)
                setConfirmed(false)
              }}
            />
            <label htmlFor={`${fieldId}-output`} className="block font-medium">
              変換後の本文
              <Textarea
                id={`${fieldId}-output`}
                rows={15}
                className="mt-2 font-serif leading-7"
                readOnly
                value={result?.text ?? ''}
              />
            </label>
            <PostingFormat format={format} setFormat={setFormat} site={site} />
            <PostingOptionsControl
              site={site}
              options={options}
              onChange={(value) => {
                setOptions(value)
                setConfirmed(false)
              }}
            />
            {result && (
              <>
                <p className="text-sm">
                  {result.characters.toLocaleString('ja-JP')}文字
                  {bytes !== undefined && ` ／ ${bytes.toLocaleString('ja-JP')} B`}
                  {limit !== undefined && `（上限 ${limit.toLocaleString('ja-JP')} B）`}
                </p>
                <PostingWarnings result={result} />
                <IllustrationList result={result} />
              </>
            )}
            {encodingError && (
              <p role="alert" className="text-sm text-destructive">
                {encodingError}
              </p>
            )}
            {tooLarge && (
              <p role="alert" className="text-sm text-destructive">
                ファイルの上限を超えています。
              </p>
            )}
            {review && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                警告のある箇所は、プレビューどおりに書き出す
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!ready}
                onClick={async () => {
                  if (result)
                    setStatus(
                      (await copyText(result.text))
                        ? 'コピーしました'
                        : 'コピーできませんでした。本文を選択してコピーしてください',
                    )
                }}
              >
                本文をコピー
              </Button>
              <Button
                disabled={!ready || !!encodingError || tooLarge}
                onClick={() => {
                  if (!result) return
                  try {
                    triggerDownload({
                      filename: '原稿.txt',
                      mime: 'text/plain',
                      data: postingEpisodeBytes(result, site, format),
                    })
                    setStatus('TXTを保存しました')
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : 'TXTを保存できませんでした')
                  }
                }}
              >
                TXTで保存
              </Button>
            </div>
          </section>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm">
            {status}
          </p>
        )}
      </div>
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Converter />)
