import { useSyncExternalStore } from 'react'
import { connections as seedConnections, syncRuns as seedRuns, type Connection, type SyncRun } from './data'

/**
 * Tiny in-memory store so actions on one Connect screen (rotate credentials,
 * retry, remove, new connection) are reflected on the others during a session.
 */
type ConnectState = { connections: Connection[]; runs: SyncRun[] }

let state: ConnectState = { connections: seedConnections, runs: seedRuns }
const listeners = new Set<() => void>()

function setState(next: ConnectState) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useConnectState(): ConnectState {
  return useSyncExternalStore(subscribe, () => state)
}

export function getConnection(id: string): Connection | undefined {
  return state.connections.find((c) => c.id === id)
}

export function updateConnection(id: string, patch: Partial<Connection>) {
  setState({ ...state, connections: state.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
}

export function upsertConnection(conn: Connection) {
  const exists = state.connections.some((c) => c.id === conn.id)
  setState({
    ...state,
    connections: exists
      ? state.connections.map((c) => (c.id === conn.id ? { ...c, ...conn } : c))
      : [conn, ...state.connections],
  })
}

export function removeConnection(id: string) {
  setState({ ...state, connections: state.connections.filter((c) => c.id !== id) })
}

let runSeq = 98422
export function recordRun(run: Omit<SyncRun, 'id'>): SyncRun {
  runSeq += 1
  const full: SyncRun = { ...run, id: `sync_${runSeq}`, at: Date.now() }
  setState({ ...state, runs: [full, ...state.runs] })
  return full
}
