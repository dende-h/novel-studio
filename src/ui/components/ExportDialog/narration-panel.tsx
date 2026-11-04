import { useEffect, useId, useState } from 'react'
import type { Episode, Inline } from '@/core/schema'
import { triggerDownload } from '@/ui/_utils/download'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'

function reading(inline: Inline): string {
  if (inline.type === 'ruby') return inline.reading
  if (inline.type === 'ref') return inline.children?.map(reading).join('') ?? inline.name
  return inline.text
}

const presets = ['', '明るく軽快に', '静かに余韻を残すように']

export function NarrationPanel({ episode }: { episode: Episode }) {
  const { getToken } = useAuth()
  const id = useId()
  const [style, setStyle] = useState('')
  const [target, setTarget] = useState('')
  const [directions, setDirections] = useState<Record<string, string>>({})
  const [audio, setAudio] = useState<Blob | null>(null)
  const [previous, setPrevious] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocks = episode.blocks.map((block) => block.inlines.map(reading).join('').trim())
  const text = blocks
    .map((line, index) => {
      if (!line) return ''
      const direction = directions[String(index)]?.trim()
      return direction ? `[${direction}] ${line}` : line
    })
    .join('\n')
    .trim()
  const heading = [style, directions['']?.trim()].filter(Boolean).join('。')
  const script = heading ? `[${heading}]\n${text}` : text
  const tooLong = new TextEncoder().encode(script).length > 16_000

  useEffect(() => {
    if (!audio) return
    const next = URL.createObjectURL(audio)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [audio])

  async function generate() {
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('session')
      const response = await fetch('/api/narration', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain;charset=UTF-8' },
        body: script,
      })
      if (!response.ok) {
        setError(
          response.status === 404
            ? '朗読を生成できる環境か確認してください。'
            : '朗読を生成できませんでした。少し待ってから、もう一度お試しください。',
        )
        return
      }
      const blob = await response.blob()
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('audio')
      setPrevious(audio)
      setAudio(blob)
    } catch {
      setError('朗読を生成できませんでした。接続を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-on-surface-variant text-sm">
        生成すると、この話の本文と演技指示を音声生成サービスの Fish Audio に送ります。
      </p>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-style`}>朗読スタイル</Label>
        <select
          id={`${id}-style`}
          value={style}
          disabled={busy}
          onChange={(event) => setStyle(event.target.value)}
        >
          {presets.map((preset) => (
            <option key={preset} value={preset}>
              {preset || '自然に'}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-target`}>指示を付ける範囲</Label>
        <select
          id={`${id}-target`}
          value={target}
          disabled={busy}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">この話</option>
          {blocks.map(
            (line, index) =>
              line && (
                <option key={episode.blocks[index]?.id} value={String(index)}>
                  {line.slice(0, 45)}
                </option>
              ),
          )}
        </select>
        <Label htmlFor={`${id}-direction`}>どんなふうに読んでほしいですか？</Label>
        <textarea
          id={`${id}-direction`}
          className="rounded-md border border-outline-variant p-2"
          rows={2}
          maxLength={120}
          disabled={busy}
          value={directions[target] ?? ''}
          placeholder="例：少し寂しそうに、最後の言葉は温かく"
          onChange={(event) => setDirections({ ...directions, [target]: event.target.value })}
        />
      </div>
      {tooLong && <p role="status">この話は試作版の生成上限を超えています。</p>}
      <Button type="button" onClick={generate} disabled={busy || !text || tooLong}>
        {busy ? '生成中…' : 'この話を生成'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {audio && (
        <div className="space-y-2">
          {/* 朗読には同じ画面の原稿が対応する。 */}
          {/* biome-ignore lint/a11y/useMediaCaption: 小説本文が朗読の原稿 */}
          <audio aria-label="朗読の試聴" className="w-full" src={url} controls />
          {previous && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAudio(previous)
                setPrevious(audio)
              }}
            >
              前の読みと切り替え
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              triggerDownload({
                filename: `${episode.title.replace(/[<>:"/\\|?*]/g, '_') || '朗読'}.mp3`,
                mime: 'audio/mpeg',
                data: new Uint8Array(await audio.arrayBuffer()),
              })
            }}
          >
            MP3を書き出す
          </Button>
        </div>
      )}
    </div>
  )
}
