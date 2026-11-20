import { useSyncExternalStore } from 'react'
import {
  freshness as seedFreshness,
  incidents as seedIncidents,
  qualityRules as seedRules,
  type FreshnessRow,
  type Incident,
  type QualityRule,
} from './data'

/**
 * In-memory Trust store so actions on one screen (resolve an incident,
 * refresh a dataset, create a rule) are reflected on the others during a session.
 */
type TrustState = {
  incidents: Incident[]
  rules: QualityRule[]
  freshness: FreshnessRow[]
  /** Incident ids whose report owners have been notified. */
  notified: string[]
}

let state: TrustState = { incidents: seedIncidents, rules: seedRules, freshness: seedFreshness, notified: [] }
const listeners = new Set<() => void>()

function setState(next: TrustState) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTrustState(): TrustState {
  return useSyncExternalStore(subscribe, () => state)
}

export function resolveIncident(id: string, time: string) {
  setState({
    ...state,
    incidents: state.incidents.map((i) =>
      i.id === id
        ? { ...i, status: 'resolved', history: [...i.history, { time, text: 'Marked resolved by Elena Vance' }] }
        : i,
    ),
  })
}

export function addRule(rule: QualityRule) {
  setState({ ...state, rules: [rule, ...state.rules] })
}

export function markFresh(dataset: string, lastUpdated: string) {
  setState({
    ...state,
    freshness: state.freshness.map((f) => (f.dataset === dataset ? { ...f, status: 'on-time', lastUpdated } : f)),
  })
}

export function markNotified(ids: string[]) {
  setState({ ...state, notified: Array.from(new Set([...state.notified, ...ids])) })
}
