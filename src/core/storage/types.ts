/**
 * 永続化の抽象。差し替え可能な KeyValue ストア契約（MemoryStore / IndexedDB が実装）。
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}
