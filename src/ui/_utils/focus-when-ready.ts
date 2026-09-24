/** 何フレーム試し直すか。React Flow の寸法計測は通常 1〜2 フレームで終わる。 */
const DEFAULT_MAX_FRAMES = 10

export interface FocusWhenReadyOptions {
  /** 最初の試行のあと、何フレームまで試し直すか（超えたら諦める）。 */
  maxFrames?: number
  /** focus() に渡すオプション（preventScroll など）。 */
  focusOptions?: FocusOptions
  /** テスト用の差し替え口。既定は window の requestAnimationFrame / cancelAnimationFrame。 */
  raf?: (cb: FrameRequestCallback) => number
  caf?: (handle: number) => void
}

/**
 * 要素が実際にフォーカスを受け取れるまで、数フレームだけ focus() を試し直す。
 *
 * React Flow は寸法を測る前のノードを visibility:hidden で隠す。隠れた要素への focus() は
 * 何も起きずに終わるので、描画直後に 1 回呼ぶだけでは外れる（マインドマップで枝を足しても
 * 入力が親に残る不具合）。すぐに 1 回試し、フォーカスを得られなければ次のフレームで試し直す。
 * 対象が document.activeElement になった時点で止め、maxFrames を超えたら諦める。
 *
 * 戻り値は予約中のフレームを取り消す関数（effect の後始末で呼ぶ）。
 */
export function focusWhenReady(
  getTarget: () => HTMLElement | null,
  {
    maxFrames = DEFAULT_MAX_FRAMES,
    focusOptions,
    raf = (cb) => window.requestAnimationFrame(cb),
    caf = (handle) => window.cancelAnimationFrame(handle),
  }: FocusWhenReadyOptions = {},
): () => void {
  let handle: number | null = null
  let retries = 0
  const attempt = () => {
    handle = null
    const el = getTarget()
    if (el) {
      if (el.ownerDocument.activeElement === el) return
      el.focus(focusOptions)
      if (el.ownerDocument.activeElement === el) return
    }
    if (retries >= maxFrames) return
    retries += 1
    handle = raf(attempt)
  }
  attempt()
  return () => {
    if (handle !== null) caf(handle)
    handle = null
  }
}
