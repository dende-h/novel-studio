/**
 * editorStore を通らないローカル変更（構造レイヤー・ネタ帳）の同期通知。
 *
 * 同期の push トリガは「store の変化を coalesce」だが、構造・ネタ帳の編集は
 * Repository 直書きで store を通らず、軽量 poll も**サーバ側**の世代しか見ないため、
 * ローカルだけの変更は push の契機を失う（stg で「構造が同期されない」となった実バグ）。
 * Repository のラッパー（Root で結線）が変更のたびに touchSync() を呼び、
 * useAutoSync が store.subscribe と同列のシグナルとして拾う。
 */

const listeners = new Set<() => void>()

/** ローカル変更を同期へ通知する（構造・ネタ帳のラッパーが呼ぶ）。 */
export function touchSync(): void {
  for (const l of listeners) l()
}

/** 通知の購読（useAutoSync が使う）。戻り値で解除。 */
export function subscribeSyncTouch(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ---- 逆方向のシグナル：同期がローカルを書き換えた（pull 適用）通知 ----------------------
// 構造ビュー・ネタ帳はマウント時に一度しかローカルデータを読まないため、pull が届いても
// 画面が変わらず「ページ遷移しないと同期されない」ように見える（stg 実機で判明）。
// Root が reconcile の changedLocal を受けてこれを鳴らし、開いている各ビューが再読込する。

const appliedListeners = new Set<() => void>()

/** 同期がローカルを書き換えたことを通知する（Root の onLocalChanged が呼ぶ）。 */
export function announceSyncApplied(): void {
  for (const l of appliedListeners) l()
}

/** pull 適用通知の購読（開いたまま自動反映したいビューが使う）。戻り値で解除。 */
export function subscribeSyncApplied(listener: () => void): () => void {
  appliedListeners.add(listener)
  return () => {
    appliedListeners.delete(listener)
  }
}

/**
 * Repository の変更系メソッドの完了後に touchSync を差し込むラッパー（Root で結線）。
 * 同期サービスは自前の Repository インスタンスを使うため、pull で自分に跳ね返るループは起きない。
 */
export function withSyncTouch<T extends object>(target: T, methods: ReadonlyArray<keyof T>): T {
  return new Proxy(target, {
    get(t, p, receiver) {
      const v = Reflect.get(t, p, receiver)
      if (typeof v !== 'function') return v
      const fn = v as (...args: unknown[]) => unknown
      if (!(methods as ReadonlyArray<PropertyKey>).includes(p)) {
        return fn.bind(t)
      }
      return (...args: unknown[]) => {
        const out = fn.apply(t, args)
        return Promise.resolve(out).then((res) => {
          touchSync()
          return res
        })
      }
    },
  })
}
