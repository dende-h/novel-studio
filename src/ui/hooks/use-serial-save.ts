import { useCallback, useRef, useState } from 'react'

export interface SerialSave<T> {
  /** 表示用の値。保存が済んだ最新（保存待ちの途中経過では巻き戻らない）。 */
  value: T | null
  /** 保存を通さずに丸ごと差し替える（初回の読み込み・新規作成）。それより前に投げた保存の結果は捨てる。 */
  reset: (v: T | null) => void
  /**
   * 外（同期の pull）で書き換わった値を取り込む。保存待ちの変更があるときは取り込まない
   *（取り込むと最新値が巻き戻り、次の変更が保存待ちの変更を落とす。保存が済めば push に乗る）。
   * 取り込んだら true。
   */
  receive: (update: (cur: T | null) => T | null) => boolean
  /** 最新の値に fn を当てて保存する。fn が同じ値を返したら（no-op）保存しない。 */
  apply: (fn: (cur: T) => T) => Promise<void>
}

/**
 * 「最新の状態に積み、保存は 1 本ずつ流す」変更の共通経路。
 *
 * 描画時点の値に fn を当てて保存すると、保存の await 中に来た次の変更も同じ古い値から
 * 作られ、後から終わった保存が先の変更を上書きして消す（例：プロットの要約欄の blur 確定の
 * 直後に状態ボタンを押すと、要約が保存データごと消える）。ここでは最新値を ref に持って
 * fn をそこへ当て、ref を即時に進める。保存は前の保存につないで直列にし、表示は最後の
 * 変更の保存が返した値（updatedAt 刻印済み）で揃える。
 */
export function useSerialSave<T>(save: (next: T) => Promise<T>): SerialSave<T> {
  const [value, setValue] = useState<T | null>(null)
  // 最新値（保存待ちの変更まで含む）。変更の fn は常にここへ当てる。
  const latest = useRef<T | null>(null)
  // 最後に保存が済んだ値。最後の変更の保存が失敗したときの戻り先。
  const saved = useRef<T | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  // 変更ごとの通し番号。表示と最新値を保存後の値へ揃えるのは、最後の変更の保存だけ。
  const seq = useRef(0)
  // reset のたびに進める。それより前の保存の結果で表示を上書きしない（作品の切り替え等）。
  const generation = useRef(0)
  const saveRef = useRef(save)
  saveRef.current = save

  const reset = useCallback((v: T | null) => {
    generation.current++
    latest.current = v
    saved.current = v
    setValue(v)
  }, [])

  const receive = useCallback((update: (cur: T | null) => T | null) => {
    if (pending.current > 0) return false
    const next = update(latest.current)
    latest.current = next
    saved.current = next
    setValue(next)
    return true
  }, [])

  const apply = useCallback((fn: (cur: T) => T) => {
    const cur = latest.current
    if (cur === null) return Promise.resolve()
    const next = fn(cur)
    if (next === cur) return Promise.resolve()
    latest.current = next
    pending.current++
    const ticket = ++seq.current
    const gen = generation.current
    const run = async () => {
      try {
        const result = await saveRef.current(next)
        if (gen !== generation.current) return
        saved.current = result
        if (ticket === seq.current) {
          latest.current = result
          setValue(result)
        }
      } catch (e) {
        // 後続の変更があれば、その保存がこの変更ごと書き直す。最後の変更なら保存済みへ戻す。
        if (gen === generation.current && ticket === seq.current) {
          latest.current = saved.current
          setValue(saved.current)
        }
        throw e
      } finally {
        pending.current--
      }
    }
    const done = queue.current.then(run)
    // 失敗しても列は止めない（次の保存は走らせる）。失敗そのものは呼び出し側へ返す。
    queue.current = done.catch(() => {})
    return done
  }, [])

  return { value, reset, receive, apply }
}
