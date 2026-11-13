export interface NarrationTransferStatus {
  busy: boolean
  error: string
  used?: number
  limit?: number
  savedAt?: number
}
const states = new Map<string, NarrationTransferStatus>()
const idle: NarrationTransferStatus = { busy: false, error: '' }
const listeners = new Set<() => void>()
export const narrationTransfer = (owner: string) => states.get(owner) ?? idle
export function setNarrationTransfer(owner: string, patch: Partial<NarrationTransferStatus>) {
  states.set(owner, { ...narrationTransfer(owner), ...patch })
  for (const listener of listeners) listener()
}
export function subscribeNarrationTransfer(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
