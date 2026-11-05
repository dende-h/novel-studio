/** Join validated MPEG-1 Layer III frames, not whole MP3 files (ID3/Xing would corrupt duration). */
export function mp3Frames(bytes: Uint8Array): { frames: Uint8Array[]; duration: number } {
  let at = 0
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51)
    at =
      10 +
      ((bytes[6] ?? 0) << 21) +
      ((bytes[7] ?? 0) << 14) +
      ((bytes[8] ?? 0) << 7) +
      (bytes[9] ?? 0) +
      ((bytes[5] ?? 0) & 16 ? 10 : 0)
  const frames: Uint8Array[] = []
  while (at + 4 <= bytes.length) {
    if (
      bytes.length - at === 128 &&
      bytes[at] === 84 &&
      bytes[at + 1] === 65 &&
      bytes[at + 2] === 71
    )
      break
    const a = bytes[at + 1] ?? 0,
      b = bytes[at + 2] ?? 0
    if (bytes[at] !== 255 || (a & 0xfe) !== 0xfa || (b & 12) !== 0)
      throw new Error('音声形式を確認できませんでした。書き出しを中止しました。')
    const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][b >> 4]
    if (!bitrate) throw new Error('MP3の形式が対応していません。')
    const length = Math.floor((144000 * bitrate) / 44100) + ((b >> 1) & 1)
    if (at + length > bytes.length) throw new Error('音声が途中で切れています。')
    const frame = bytes.slice(at, at + length)
    const text = new TextDecoder('latin1').decode(frame.subarray(0, 60))
    if (!text.includes('Xing') && !text.includes('Info') && !text.includes('VBRI'))
      frames.push(frame)
    at += length
  }
  if (!frames.length || (at !== bytes.length && bytes.length - at !== 128))
    throw new Error('音声を確認できませんでした。')
  return { frames, duration: (frames.length * 1152) / 44100 }
}
export function joinMp3(parts: { data: Uint8Array; pauseMs: number }[], silence: Uint8Array) {
  const silent = mp3Frames(silence).frames
  const chunks: Uint8Array[] = []
  const timeline: { start: number; end: number }[] = []
  let duration = 0
  for (const [index, part] of parts.entries()) {
    const parsed = mp3Frames(part.data),
      start = duration
    chunks.push(...parsed.frames)
    duration += parsed.duration
    timeline.push({ start, end: duration })
    if (index < parts.length - 1) {
      const count = Math.round(((part.pauseMs / 1000) * 44100) / 1152)
      for (let i = 0; i < count; i++) chunks.push(silent[i % silent.length]!)
      duration += (count * 1152) / 44100
    }
  }
  const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return { data, timeline, duration }
}
export function narrationFilename(work: string, episode: string, index: number): string {
  return (
    `${work}_${String(index + 1).padStart(3, '0')}_${episode}`
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 150) + '.mp3'
  )
}
