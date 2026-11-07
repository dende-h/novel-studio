import { Pause, Play } from 'lucide-react'
import { type RefObject, useState } from 'react'

const time = (value: number) => {
  const seconds = Math.max(0, Math.floor(value || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** One accessible play/seek/time control, shared by auditions and the full reading. */
export function NarrationPlayer({
  audioRef,
  url,
  label,
  position,
  onPosition,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  url: string
  label: string
  position: number
  onPosition: (value: number) => void
}) {
  const [running, setRunning] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  return (
    <fieldset className="narration-audio" aria-label={label}>
      {/* biome-ignore lint/a11y/useMediaCaption: 朗読対象の原稿を画面中央に表示する。 */}
      <audio
        ref={audioRef}
        key={url}
        src={url}
        onLoadedMetadata={() => {
          const audio = audioRef.current
          if (!audio) return
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
          audio.currentTime = position
          setRunning(false)
          setError('')
        }}
        onPlay={() => setRunning(true)}
        onPause={() => setRunning(false)}
        onEnded={() => setRunning(false)}
        onError={() => setError('再生できません。もう一度音声を開いてください。')}
        onTimeUpdate={() => onPosition(audioRef.current?.currentTime ?? 0)}
      />
      <button
        type="button"
        aria-label={running ? '一時停止' : label + 'を再生'}
        onClick={() => {
          const audio = audioRef.current
          if (!audio) return
          if (audio.paused)
            void audio.play().catch(() => setError('再生ボタンをもう一度押してください。'))
          else audio.pause()
        }}
      >
        {running ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <input
        type="range"
        aria-label={label + 'の再生位置'}
        min={0}
        max={duration || 1}
        step={0.05}
        value={Math.min(position, duration || 1)}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (audioRef.current) audioRef.current.currentTime = value
          onPosition(value)
        }}
      />
      <span className="narration-audio-time">
        {time(position)} / {time(duration)}
      </span>
      {error && <span role="alert">{error}</span>}
    </fieldset>
  )
}
