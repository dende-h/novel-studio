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
