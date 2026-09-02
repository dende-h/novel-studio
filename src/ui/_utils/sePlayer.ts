import { type PresetSe, presetSe, type SeRepeat, seDuration } from '@/core/game/sePresets'
import { type CatalogSe, templateUrl } from '@/core/game/templates'

/**
 * 効果音レシピ（core/game/sePresets）の試聴用インタプリタ（DOM/Web Audio 依存）。
 * 書き出したプレイヤー（novelGamePlayer.ts 内の ES5 実装）と同じ契約で鳴らす——
 * レシピの読み方を変えるときは必ず両方を揃えること。
 * （happy-dom は AudioContext 非対応のため unit テスト対象外。手動／実ブラウザで検証）
 */

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null

function ensureAudio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function getNoise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/** ループの試聴で鳴らす回数。編集中に鳴り続けると邪魔なので、繰り返しが分かる長さで止める。 */
const LOOP_PREVIEW_TIMES = 3

/**
 * レシピを鳴らす（試聴）。キーが未知・Web Audio 不可のときは何もしない。
 * 鳴らし方は演出の指定に合わせる——ただし**ループは 3 回ぶんで止める**
 * （書き出したプレイヤーでは次の場面の切れ目まで続く）。
 */
export function playPresetSe(key: string, repeat?: SeRepeat): void {
  const se: PresetSe | undefined = presetSe(key)
  if (!se) return
  const ac = ensureAudio()
  if (!ac) return
  const times = repeat === 'loop' ? LOOP_PREVIEW_TIMES : repeat === 2 ? 2 : 1
  const period = Math.max(0.2, seDuration(se))
  for (let n = 0; n < times; n++) scheduleSe(ac, se, ac.currentTime + 0.02 + n * period)
}

function scheduleSe(ac: AudioContext, se: PresetSe, base: number): void {
  for (const s of se.steps) {
    const t0 = base + (s.t ?? 0)
    const g = s.g ?? 0.5
    let src: AudioBufferSourceNode | OscillatorNode
    if (s.w === 'noise') {
      const node = ac.createBufferSource()
      node.buffer = getNoise(ac)
      node.loop = true
      src = node
    } else {
      const osc = ac.createOscillator()
      osc.type = s.w
      osc.frequency.setValueAtTime(s.f ?? 440, t0)
      if (s.f2) osc.frequency.exponentialRampToValueAtTime(s.f2, t0 + s.d)
      src = osc
    }
    let node: AudioNode = src
    if (s.lp) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(s.lp, t0)
      if (s.lp2) lp.frequency.exponentialRampToValueAtTime(s.lp2, t0 + s.d)
      node.connect(lp)
      node = lp
    }
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(g, 0.001), t0 + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + s.d)
    node.connect(gain)
    gain.connect(ac.destination)
    src.start(t0)
    src.stop(t0 + s.d + 0.05)
  }
}

// ---------------------------------------------------------------------------
// 音声ファイルの効果音（運営テンプレの目録にある実体）
// ---------------------------------------------------------------------------

const fileBuffers = new Map<string, Promise<AudioBuffer | null>>()

/** 音声ファイルを取って復号する（同じ URL は 1 回）。失敗は null（次の試聴でもう一度取る）。 */
function loadFileBuffer(ac: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = fileBuffers.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ac.decodeAudioData(ab))
      .catch(() => {
        fileBuffers.delete(url)
        return null
      })
    fileBuffers.set(url, p)
  }
  return p
}

/** 音声ファイルの試聴。鳴らし方は合成と同じ規則（ループは 3 回ぶんで止める）。 */
export async function playSeFile(url: string, repeat?: SeRepeat): Promise<void> {
  const ac = ensureAudio()
  if (!ac) return
  const buf = await loadFileBuffer(ac, url)
  if (!buf) return
  const times = repeat === 'loop' ? LOOP_PREVIEW_TIMES : repeat === 2 ? 2 : 1
  let at = ac.currentTime + 0.02
  for (let n = 0; n < times; n++) {
    const src = ac.createBufferSource()
    src.buffer = buf
    src.connect(ac.destination)
    src.start(at)
    at += buf.duration
  }
}

/** 目録の効果音を試聴する（音声ファイルがあればそれ、無ければ組み込みの合成レシピ）。 */
export function playCatalogSe(se: CatalogSe, repeat?: SeRepeat): void {
  if (se.entry) {
    void playSeFile(templateUrl(se.entry), repeat)
    return
  }
  playPresetSe(se.key, repeat)
}
