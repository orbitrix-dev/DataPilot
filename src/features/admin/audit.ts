import { useAutomateState } from '../automate/store'
import { when } from '../command-center/activity'
import { useConnectState } from '../connect/store'
import { ipByName, ME_IP, type AuditEvent, type AuditType } from './data'
import { useAdminState } from './store'

export type AuditRow = AuditEvent & { label: string; day: string; sort: number }

const NOT_HUMAN = new Set(['Pre-approved alert', 'Dry run (test)'])

/**
 * The audit log: admin events from the Admin store, plus workflow approvals
 * (Automate runs) and credential rotations (Connect), newest first.
 */
export function useAuditLog(): AuditRow[] {
  const { audit } = useAdminState()
  const { runs, workflows } = useAutomateState()
  const { connections } = useConnectState()

  const events: AuditEvent[] = [...audit]

  for (const r of runs) {
    if (r.outcome === 'test' || NOT_HUMAN.has(r.approvedBy)) continue
    const name = workflows.find((w) => w.id === r.workflowId)?.name ?? r.workflowId
    const rejected = r.outcome === 'rejected'
    events.push({
      id: `run-${r.id}`,
      type: 'workflow',
      event: rejected ? 'Workflow Rejected' : 'Workflow Approved',
      actor: r.approvedBy,
      detail: `${rejected ? 'Rejected' : 'Approved'} ${r.requestId ?? r.id}${rejected ? '' : ` for ${r.id}`} (${name})`,
      ip: r.at ? ME_IP : (ipByName[r.approvedBy] ?? '—'),
      time: r.time,
      at: r.at,
      to: `/automate/runs/${r.id}`,
    })
  }

  for (const c of connections) {
    if (!c.rotated) continue
    events.push({
      id: `rot-${c.id}-${c.rotated.at ?? 0}`,
      type: 'connection',
      event: 'Credential Rotated',
      actor: c.rotated.by,
      detail: `Rotated the read-only credential on ${c.name}`,
      ip: c.rotated.at ? ME_IP : (ipByName[c.rotated.by] ?? '—'),
      time: c.rotated.time,
      at: c.rotated.at,
      to: `/connect/connections/${c.id}`,
    })
  }

  return events
    .map((e) => {
      const w = when(e.time, e.at)
      return { ...e, label: w.time, day: w.day, sort: w.sort }
    })
    .sort((a, b) => b.sort - a.sort)
}

export const auditTone: Record<AuditType, string> = {
  login: 'bg-light-surface-container text-light-on-surface',
  permission: 'bg-warning-container text-on-warning-container',
  user: 'bg-light-surface-container text-light-on-surface',
  'api-key': 'bg-info-container text-on-info-container',
  connection: 'bg-light-surface-container text-light-on-surface',
  workflow: 'bg-light-primary-container text-light-on-primary-container',
  settings: 'bg-light-surface-container text-light-on-surface',
  billing: 'bg-light-surface-container text-light-on-surface',
}
