import {
  type PresetSe,
  presetSe,
  type SeRepeat,
  type SeStep,
  seDuration,
  sePeriod,
} from '@/core/game/sePresets'
import { type CatalogSe, templateUrl } from '@/core/game/templates'

/**
 * 効果音レシピ（core/game/sePresets）の試聴用インタプリタ（DOM/Web Audio 依存）。
 * 書き出したプレイヤー（novelGamePlayer.ts 内の ES5 実装）と同じ契約で鳴らす——
 * レシピの読み方を変えるときは必ず両方を揃えること。
 * （happy-dom は AudioContext 非対応のため unit テスト対象外。手動／実ブラウザで検証）
 */

let ctx: AudioContext | null = null
const noiseBufs = new Map<string, AudioBuffer>()
let reverbIr: AudioBuffer | null = null

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

/**
 * ノイズ 3 色（2 秒ぶん・ループで使う）。
 * pink は Paul Kellet の近似、brown は白色の積分（漏れつき）。両インタプリタで同じ式。
 */
function getNoise(ac: AudioContext, kind: 'noise' | 'pink' | 'brown'): AudioBuffer {
  const cached = noiseBufs.get(kind)
  if (cached) return cached
  const len = ac.sampleRate * 2
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  if (kind === 'noise') {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  } else if (kind === 'pink') {
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  } else {
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      data[i] = last * 3.5
    }
  }
  noiseBufs.set(kind, buf)
  return buf
}

/** 合成した部屋の残響（1.6 秒・指数減衰のノイズ・ステレオ）。 */
function getReverbIr(ac: AudioContext): AudioBuffer {
  if (reverbIr) return reverbIr
  const len = Math.floor(ac.sampleRate * 1.6)
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-4.5 * i) / len)
    }
  }
  reverbIr = buf
  return buf
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
  // ループは重ねる周期、2 回は鳴り終わってから
  const period = repeat === 'loop' ? sePeriod(se) : Math.max(0.2, seDuration(se))
  for (let n = 0; n < times; n++) scheduleSe(ac, se.steps, ac.currentTime + 0.02 + n * period)
}

/** レシピ 1 回ぶんを base（AudioContext の絶対秒）から鳴らす。 */
function scheduleSe(ac: AudioContext, steps: SeStep[], base: number): void {
  const dest = ac.destination
  let reverb: ConvolverNode | null = null
  const getReverb = () => {
    if (!reverb) {
      reverb = ac.createConvolver()
      reverb.buffer = getReverbIr(ac)
      reverb.connect(dest)
    }
    return reverb
  }
  for (const s of steps) {
    const t0 = base + (s.t ?? 0)
    const end = t0 + s.d
    const peak = Math.max(s.g ?? 0.5, 0.001)
    let src: AudioBufferSourceNode | OscillatorNode
    if (s.w === 'noise' || s.w === 'pink' || s.w === 'brown') {
      const node = ac.createBufferSource()
      node.buffer = getNoise(ac, s.w)
      node.loop = true
      src = node
    } else {
      const osc = ac.createOscillator()
      osc.type = s.w
      osc.frequency.setValueAtTime(s.f ?? 440, t0)
      if (s.f2) osc.frequency.exponentialRampToValueAtTime(s.f2, end)
      src = osc
    }
    let node: AudioNode = src
    if (s.hp) {
      const hp = ac.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.setValueAtTime(s.hp, t0)
      node.connect(hp)
      node = hp
    }
    if (s.bp) {
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.setValueAtTime(s.bp, t0)
      if (s.bp2) bp.frequency.exponentialRampToValueAtTime(s.bp2, end)
      bp.Q.setValueAtTime(s.q ?? 1, t0)
      node.connect(bp)
      node = bp
    }
    if (s.lp) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(s.lp, t0)
      if (s.lp2) lp.frequency.exponentialRampToValueAtTime(s.lp2, end)
      node.connect(lp)
      node = lp
    }
    // エンベロープ：a 秒で立ち上がり → s 秒保つ → end までに指数減衰
    const attack = Math.max(0.001, s.a ?? 0.015)
    const holdUntil = t0 + attack + (s.s ?? 0)
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, Math.min(t0 + attack, end))
    if (holdUntil > t0 + attack && holdUntil < end) gain.gain.setValueAtTime(peak, holdUntil)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    // 音量の揺らぎ（LFO を gain の値に足す）
    if (s.mf && s.md) {
      const lfo = ac.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(s.mf, t0)
      const depth = ac.createGain()
      depth.gain.setValueAtTime(peak * Math.min(s.md, 0.9), t0)
      lfo.connect(depth)
      depth.connect(gain.gain)
      lfo.start(t0)
      lfo.stop(end + 0.05)
    }
    node.connect(gain)
    gain.connect(dest)
    if (s.rv) {
      const send = ac.createGain()
      send.gain.setValueAtTime(Math.min(s.rv, 1), t0)
      gain.connect(send)
      send.connect(getReverb())
    }
    src.start(t0)
    src.stop(end + 0.05)
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
