import { useConnectState } from '../connect/store'
import { planById, STORAGE_USED_GB, type Plan } from './data'
import { seatsUsed, useAdminState } from './store'

export type Usage = { sources: number; rows: number; storageGb: number; seats: number }

/** Current consumption, read live from Connect (sources, rows) and the Admin store (seats). */
export function useUsage(): Usage & { plan: Plan } {
  const { connections } = useConnectState()
  const s = useAdminState()
  return {
    // File uploads are one-off copies, not connected sources.
    sources: connections.filter((c) => c.kind !== 'file').length,
    rows: connections.reduce((n, c) => n + c.records, 0),
    storageGb: STORAGE_USED_GB,
    seats: seatsUsed(s),
    plan: planById(s.plan),
  }
}

/** Limits the current usage would exceed on another plan. */
export function overLimits(u: Usage, p: Plan): string[] {
  const out: string[] = []
  if (u.seats > p.seats) out.push(`${u.seats} seats in use (plan allows ${p.seats})`)
  if (u.sources > p.sources) out.push(`${u.sources} connected sources (plan allows ${p.sources})`)
  if (u.rows > p.rows) out.push(`${formatRows(u.rows)} rows this cycle (plan allows ${formatRows(p.rows)})`)
  if (u.storageGb > p.storageGb) out.push(`${u.storageGb} GB stored (plan allows ${p.storageGb} GB)`)
  return out
}

export function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}
