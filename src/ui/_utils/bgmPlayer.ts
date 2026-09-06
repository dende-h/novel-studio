import { type CatalogBgm, templateUrl } from '@/core/game/templates'

/**
 * BGM の試聴（DOM/Web Audio 依存）。演出エディタ・テンプレ一覧・管理ページで共用する。
 *
 * 書き出したプレイヤー（novelGamePlayer.ts の startBgm）と同じ鳴らし方＝1 本の AudioBufferSource を
 * `loop = true` で回し、目録の `loopStart` / `loopEnd` をそのまま流す。運営が管理ページで
 * ループ区間を打つときに、継ぎ目を**実際に聞いて**確かめられるようにするため。
 * 同時に鳴るのは 1 曲だけ（別の曲を鳴らせば前の曲は止まる）。
 * （happy-dom は AudioContext 非対応のため unit テスト対象外。手動／実ブラウザで検証）
 */

const PREVIEW_GAIN = 0.6

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
let playing: { url: string; source: AudioBufferSourceNode; gain: GainNode } | null = null
const listeners = new Set<() => void>()

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

function loadBuffer(ac: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ac.decodeAudioData(ab))
      .catch(() => {
        buffers.delete(url)
        return null
      })
    buffers.set(url, p)
  }
  return p
}

const notify = () => {
  for (const cb of listeners) cb()
}

/** 試聴の状態変化（鳴り始め・止まった）を知りたい画面が購読する。 */
export function subscribeBgmPreview(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** いま試聴中の URL（無ければ null）。ボタンの「再生／停止」の表示に使う。 */
export const bgmPreviewingUrl = (): string | null => playing?.url ?? null

/** 試聴を止める（鳴っていなければ何もしない）。 */
export function stopBgmPreview(): void {
  if (!playing) return
  const { source, gain } = playing
  playing = null
  notify()
  const ac = ctx
  if (ac) {
    try {
      gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08)
    } catch {
      // 既に止まっている等。止められなくても次の試聴で新しい経路を作る
    }
  }
  setTimeout(() => {
    try {
      source.stop()
    } catch {
      // 未開始・二重停止は無視
    }
    try {
      gain.disconnect()
    } catch {
      // 同上
    }
  }, 400)
}

/**
 * URL の曲を試聴する（ループ区間つき）。同じ URL がすでに鳴っていれば止める（トグル）。
 * 取れない・復号できないときは黙って何もしない（呼び出し側は結果を待たない）。
 */
export async function toggleBgmPreview(
  url: string,
  loop: { loopStart?: number; loopEnd?: number } = {},
): Promise<void> {
  if (playing?.url === url) {
    stopBgmPreview()
    return
  }
  stopBgmPreview()
  const ac = ensureAudio()
  if (!ac) return
  const buf = await loadBuffer(ac, url)
  // 待っている間に別の曲が始まっていたら、こちらは鳴らさない
  if (!buf || (playing && playing.url !== url)) return
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, ac.currentTime)
  gain.gain.exponentialRampToValueAtTime(PREVIEW_GAIN, ac.currentTime + 0.4)
  gain.connect(ac.destination)
  const source = ac.createBufferSource()
  source.buffer = buf
  source.loop = true
  const ls = loop.loopStart ?? 0
  const le = loop.loopEnd ?? 0
  if (le > ls && le <= buf.duration) {
    source.loopStart = ls
    source.loopEnd = le
  }
  source.connect(gain)
  source.start(ac.currentTime + 0.02)
  playing = { url, source, gain }
  notify()
}

/** 目録の BGM を試聴する（トグル）。 */
export function toggleCatalogBgm(bgm: CatalogBgm): void {
  if (!bgm.entry) return
  void toggleBgmPreview(templateUrl(bgm.entry), {
    ...(bgm.loopStart !== undefined ? { loopStart: bgm.loopStart } : {}),
    ...(bgm.loopEnd !== undefined ? { loopEnd: bgm.loopEnd } : {}),
  })
}

/** 目録の BGM が試聴中か。 */
export function isCatalogBgmPreviewing(bgm: CatalogBgm): boolean {
  return Boolean(bgm.entry) && bgm.entry !== undefined && playing?.url === templateUrl(bgm.entry)
}
