export async function abortable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let abort = () => {}
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      void run().then(resolve, reject)
    })
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

export async function readManuscriptFile(file: Blob, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const reader = new FileReader()
  const abort = () => reader.abort()
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await new Promise((resolve, reject) => {
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result))
        else reject(new Error('ファイルを読み込めません'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めません'))
      reader.onabort = () =>
        reject(signal.reason ?? new DOMException('File reading cancelled', 'AbortError'))
      reader.readAsArrayBuffer(file)
    })
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
