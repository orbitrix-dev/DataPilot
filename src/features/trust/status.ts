import type { StatusTone } from '../connect/status'
import type { FreshnessStatus, Incident, IncidentStatus, RuleStatus } from './data'

/** Severity chip. A resolved incident shows "Resolved" in place of its severity (as in the incident list design). */
export function severityMeta(i: Pick<Incident, 'severity' | 'status'>): { tone: StatusTone; label: string } {
  if (i.status === 'resolved') return { tone: 'success', label: 'Resolved' }
  return i.severity === 'critical' ? { tone: 'error', label: 'Critical' } : { tone: 'warning', label: 'Warning' }
}

export const incidentStatusMeta: Record<IncidentStatus, { label: string; className: string }> = {
  investigating: { label: 'Investigating', className: 'text-light-on-surface' },
  acknowledged: { label: 'Acknowledged', className: 'text-light-on-surface' },
  resolved: { label: 'Verified fixed', className: 'text-success' },
}

export const ruleStatusTone: Record<RuleStatus, StatusTone> = {
  passing: 'success',
  failed: 'error',
  warning: 'warning',
  pending: 'neutral',
}

export const freshnessMeta: Record<FreshnessStatus, { tone: StatusTone; label: string; textClass: string }> = {
  'on-time': { tone: 'success', label: 'On time', textClass: '' },
  stale: { tone: 'warning', label: 'Stale', textClass: 'text-warning' },
  breached: { tone: 'error', label: 'SLA breached', textClass: 'text-error' },
}

export const isOpen = (i: Pick<Incident, 'status'>) => i.status !== 'resolved'
