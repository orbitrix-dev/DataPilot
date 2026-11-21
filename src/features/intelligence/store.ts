import { useSyncExternalStore } from 'react'
import { seedHistory, type HistoryEntry } from './data'

/**
 * Session state for Intelligence: questions asked during the session (shown
 * at the top of Conversation History) and purchase-order drafts created from
 * the stock-out recommendation.
 */
type IntelligenceState = {
  history: HistoryEntry[]
  /** SKUs that have a PO draft pending approval. */
  poDrafts: string[]
  /** When the current PO draft was created (ms since epoch). */
  poDraftAt?: number
  /** Answer most recently asked, used by the home page's evidence shortcut. */
  lastAnswerId?: string
}

let state: IntelligenceState = { history: seedHistory, poDrafts: [] }
const listeners = new Set<() => void>()
let seq = 0

function setState(next: IntelligenceState) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useIntelligenceState(): IntelligenceState {
  return useSyncExternalStore(subscribe, () => state)
}

function nowLabel(): string {
  const d = new Date()
  return `Today, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function recordQuestion(entry: Omit<HistoryEntry, 'id' | 'asked'>) {
  seq += 1
  setState({
    ...state,
    history: [{ ...entry, id: `s${seq}`, asked: nowLabel(), at: Date.now() }, ...state.history],
    lastAnswerId: entry.answerId ?? state.lastAnswerId,
  })
}

export function createPoDraft(skus: string[]) {
  setState({ ...state, poDrafts: Array.from(new Set([...state.poDrafts, ...skus])), poDraftAt: Date.now() })
}

export function discardPoDraft() {
  setState({ ...state, poDrafts: [], poDraftAt: undefined })
}
