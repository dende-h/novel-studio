import { useId, useMemo, useState } from 'react'
import {
  DEFAULT_POSTING_TEXT_FORMAT,
  encodePostingText,
  episodeTxtName,
  importedIllustrationsZip,
  kakuyomuWorkZip,
  type PostingTextFormat,
  postingEpisodeBytes,
  postingEpisodesZip,
  postingZipTitle,
  safePostingName,
} from '@/core/exporter/posting-files'
import { type PostingOptions, toPostingSite } from '@/core/exporter/toPostingSite'
import type { Work } from '@/core/schema'
import { type PostingSiteId, postingProfile } from '@/core/sites/portability'
import { copyText } from '@/ui/_utils/clipboard'
import { triggerDownload } from '@/ui/_utils/download'
import {
  IllustrationList,
  PostingWarnings,
  postingSites,
  selectClass,
} from '@/ui/components/TextImportDialog/posting-preview'
import { Button } from '@/ui/components/ui/button'
import { Textarea } from '@/ui/components/ui/textarea'

export function PostingDestination({
  site,
  onChange,
}: {
  site: PostingSiteId
  onChange: (site: PostingSiteId) => void
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      投稿先
      <select
        value={site}
        className={selectClass}
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
}: {
  site: PostingSiteId
  options: PostingOptions
  onChange: (options: PostingOptions) => void
}) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
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
      {site === 'pixiv' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(options.pixivOriginalWork)}
            onChange={(event) => onChange({ ...options, pixivOriginalWork: event.target.checked })}
          />
          同じ作品を更新する（アップロード済みの挿絵IDを使う）
        </label>
      )}
      {(site === 'narou' || site === 'akatsuki') && (
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

export function PostingExport({
  work,
  initialEpisode,
  compatible,
}: {
  work: Work
  initialEpisode?: string
  compatible?: boolean
}) {
  const textId = useId()
  const [destination, setDestination] = useState<PostingSiteId>('narou')
  const [previewId, setPreviewId] = useState(initialEpisode ?? work.episodes[0]?.id ?? '')
  const [ids, setIds] = useState<string[]>(
    initialEpisode ? [initialEpisode] : work.episodes.map((episode) => episode.id),
  )
  const [format, setFormat] = useState(DEFAULT_POSTING_TEXT_FORMAT)
  const [options, setOptions] = useState<PostingOptions>({})
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const site = compatible ? 'kakuyomu' : destination
  const profile = postingProfile(site)
  const episode = work.episodes.find((item) => item.id === previewId) ?? work.episodes[0]
  const selected = compatible
    ? work.episodes
    : work.episodes.filter((item) => ids.includes(item.id))
  const result = useMemo(
    () => (episode ? toPostingSite(episode.blocks, site, options) : null),
    [episode, site, options],
  )
  const batch = useMemo(
    () =>
      work.episodes.map((item) => ({
        id: item.id,
        result: toPostingSite(item.blocks, site, options),
      })),
    [work.episodes, site, options],
  )
  const batchReview = selected.filter((item) =>
    batch.find((row) => row.id === item.id)?.result.warnings.some((warning) => warning.needsReview),
  )
  const previewReview = Boolean(result?.warnings.some((warning) => warning.needsReview))
  const canWriteOne = Boolean(episode && result && (!previewReview || confirmed))
  const canWriteZip =
    selected.length > 0 &&
    (!batchReview.length || confirmed) &&
    (!profile.maxEpisodes || selected.length <= profile.maxEpisodes)
  let bytes: number | undefined
  let encodingError = ''
  if (result) {
    try {
      bytes = encodePostingText(result.text, format).length
    } catch (cause) {
      encodingError = cause instanceof Error ? cause.message : '文字コードを変換できません'
    }
  }
  const limited = profile.maxBytes !== undefined && bytes !== undefined && bytes > profile.maxBytes

  async function copy(value: string) {
    setError('')
    setStatus(
      (await copyText(value))
        ? 'コピーしました'
        : 'コピーできませんでした。本文を選択してコピーしてください',
    )
  }

  function download(filename: string, mime: string, data: () => Uint8Array | string) {
    setError('')
    try {
      triggerDownload({ filename, mime, data: data() })
      setStatus('書き出しました')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '書き出せませんでした')
    }
  }

  return (
    <div className="space-y-4">
      {compatible ? (
        <p className="text-sm text-on-surface-variant">
          作品全体を、作品情報と話別のUTF-8 TXTを含むZIPにまとめます。
        </p>
      ) : (
        <PostingDestination
          site={site}
          onChange={(value) => {
            setDestination(value)
            setFormat(DEFAULT_POSTING_TEXT_FORMAT)
            setConfirmed(false)
            setError('')
            setStatus('')
          }}
        />
      )}
      {profile.txt && !compatible && (
        <p className="text-sm">投稿画面の「ファイルをアップロード」で読み込めます。</p>
      )}
      {site === 'noveldays' && <p className="text-sm">NOVEL DAYSの一般小説記法で保存します。</p>}
      {!compatible && <PostingFormat format={format} setFormat={setFormat} site={site} />}
      {!compatible && (
        <PostingOptionsControl
          site={site}
          options={options}
          onChange={(value) => {
            setOptions(value)
            setConfirmed(false)
          }}
        />
      )}
      {work.episodes.length > 0 ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          プレビューする話
          <select
            className={selectClass}
            value={episode?.id ?? ''}
            onChange={(event) => {
              setPreviewId(event.target.value)
              setConfirmed(false)
            }}
          >
            {work.episodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm">書き出せる話がありません。</p>
      )}
      {episode && result && (
        <div className="space-y-2">
          <label htmlFor={textId} className="block text-sm">
            投稿用の本文
            <Textarea id={textId} rows={6} readOnly value={result.text} />
          </label>
          <p className="text-sm">
            {result.characters.toLocaleString('ja-JP')}文字
            {bytes !== undefined && ` ／ ${bytes.toLocaleString('ja-JP')} B`}
            {profile.maxBytes && `（上限 ${profile.maxBytes.toLocaleString('ja-JP')} B）`}
            {profile.guideChars &&
              ` ／ 1話 ${profile.guideChars.toLocaleString('ja-JP')}文字が目安`}
          </p>
          {encodingError && (
            <p role="alert" className="text-sm text-destructive">
              {encodingError}
            </p>
          )}
          {limited && (
            <p role="alert" className="text-sm text-destructive">
              ファイルの上限を超えています。
            </p>
          )}
          <PostingWarnings result={result} />
          <IllustrationList
            result={result}
            assets={work.manuscriptImport?.assets.map((item) => ({
              path: item.path,
              url: item.image,
            }))}
          />
          {!compatible && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canWriteOne}
                onClick={() => void copy(result.text)}
              >
                本文をコピー
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canWriteOne || !!encodingError || limited}
                onClick={() =>
                  download(episodeTxtName(episode), 'text/plain', () =>
                    postingEpisodeBytes(result, site, format),
                  )
                }
              >
                この話をTXTで保存
              </Button>
            </div>
          )}
        </div>
      )}
      {(previewReview || batchReview.length > 0) && (
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
        <Button size="sm" variant="ghost" onClick={() => void copy(work.title)}>
          作品名をコピー
        </Button>
        {episode && (
          <Button size="sm" variant="ghost" onClick={() => void copy(episode.title)}>
            話タイトルをコピー
          </Button>
        )}
        {work.description && (
          <Button size="sm" variant="ghost" onClick={() => void copy(work.description!)}>
            あらすじをコピー
          </Button>
        )}
      </div>
      {!compatible && work.episodes.length > 0 && (
        <details className="text-sm">
          <summary>ZIPに入れる話（{selected.length}話）</summary>
          {site === 'akatsuki' && (
            <p className="my-1">
              ファイル名の番号を含めて投稿先の話タイトルになります。追加された話は下書きになります。
            </p>
          )}
          {profile.maxEpisodes && (
            <p className="my-1">一度に{profile.maxEpisodes}話までアップロードできます。</p>
          )}
          <div className="my-1 flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIds(work.episodes.map((item) => item.id))}
            >
              すべて選ぶ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIds([])}>
              選択を外す
            </Button>
          </div>
          <ul className="max-h-40 space-y-1 overflow-auto">
            {work.episodes.map((item) => (
              <li key={item.id}>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={ids.includes(item.id)}
                    onChange={(event) => {
                      setConfirmed(false)
                      setIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }}
                  />
                  {site === 'akatsuki' && ids.includes(item.id)
                    ? postingZipTitle(item, selected.indexOf(item))
                    : item.title}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      {batchReview.length > 0 && (
        <p className="text-sm">
          変換を確認する話　{batchReview.map((item) => item.title).join('、')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canWriteZip}
          onClick={() =>
            download(
              safePostingName(work.title) + (compatible ? '_カクヨム互換.zip' : '.zip'),
              'application/zip',
              () =>
                compatible
                  ? kakuyomuWorkZip(work, options)
                  : postingEpisodesZip(selected, site, format, options),
            )
          }
        >
          {compatible ? 'カクヨム互換ZIPを保存' : '選んだ話をZIPで保存'}
        </Button>
        {result && result.illustrations.length > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              download('挿絵の位置.txt', 'text/plain;charset=utf-8', () =>
                result.illustrations
                  .map(
                    (ref) =>
                      ref.line +
                      '行目　' +
                      ref.name +
                      '　' +
                      (ref.disposition === 'keep' ? 'そのまま使えるタグ' : '投稿先で差し替え'),
                  )
                  .join('\n'),
              )
            }
          >
            挿絵の位置をTXTで保存
          </Button>
        )}
        {work.manuscriptImport?.notes && (
          <Button
            variant="outline"
            onClick={() =>
              download(
                '取込情報.txt',
                'text/plain;charset=utf-8',
                () => work.manuscriptImport?.notes ?? '',
              )
            }
          >
            取込情報.txtを保存
          </Button>
        )}
        {work.manuscriptImport?.assets.length ? (
          <Button
            variant="outline"
            onClick={() =>
              download('挿絵と位置.zip', 'application/zip', () => importedIllustrationsZip(work))
            }
          >
            挿絵と位置をZIPで保存
          </Button>
        ) : null}
      </div>
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
