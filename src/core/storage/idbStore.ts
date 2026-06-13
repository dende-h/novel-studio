import type { KeyValueStore } from './types'

/**
 * IndexedDB の薄い自前ラッパ（依存ゼロ・型付き・Promise 化）。
 * 単一オブジェクトストア 'kv'（key=string）に正本 JSON を格納する。
 * IndexedDB は put/get 時に構造化複製するため、値の隔離は自動。
 */
export class IdbStore implements KeyValueStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(
    private dbName = 'novel-studio',
    private storeName = 'kv',
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(this.storeName)) {
            req.result.createObjectStore(this.storeName)
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return this.dbPromise
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode)
      const req = run(tx.objectStore(this.storeName))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  }

  async get<T>(key: string): Promise<T | undefined> {
    const v = await this.tx<T | undefined>('readonly', (s) => s.get(key))
    return v === undefined ? undefined : v
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.tx('readwrite', (s) => s.put(value, key))
  }

  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key))
  }

  async keys(prefix?: string): Promise<string[]> {
    const keys = await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    const strs = keys.map(String)
    return prefix ? strs.filter((k) => k.startsWith(prefix)) : strs
  }
}
