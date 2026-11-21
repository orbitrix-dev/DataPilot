import { Link, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { auditTone, useAuditLog, type AuditRow } from '../audit'
import { AdminHeader, AdminPage } from '../components/parts'
import { fieldClass, panelClass, thClass } from '../styles'
import { auditTypes, type AuditType } from '../data'
import { useAdminState } from '../store'

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`

function exportCsv(rows: AuditRow[]) {
  const head = ['Timestamp (UTC)', 'Actor', 'Event', 'Type', 'Target / Detail', 'Source IP']
  const body = rows.map((r) => [r.label, r.actor, r.event, auditTypes[r.type], r.detail, r.ip].map(csvCell).join(','))
  const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'datapilot-audit-log.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Audit Logs (designed: admin_audit_logs). Reads admin events plus Automate approvals and Connect rotations. */
export function AuditLogsPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Audit Logs' }])
  const rows = useAuditLog()
  const { org } = useAdminState()
  const [params, setParams] = useSearchParams()
  const type = (params.get('type') ?? '') as AuditType | ''
  const q = params.get('q') ?? ''

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(
    (r) => (!type || r.type === type) && (!needle || [r.actor, r.event, r.detail, r.ip].some((f) => f.toLowerCase().includes(needle))),
  )

  return (
    <AdminPage width="6xl">
      <AdminHeader
        title="Security & Compliance Audit Logs"
        description={`Immutable record of logins, permission changes, API key events, and data connection access. Retained for ${org.retention.replace(/ \(.*\)/, '')}.`}
        actions={
          <Button variant="secondary" icon="download" onClick={() => exportCsv(shown)} disabled={!shown.length}>
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-light-on-surface-variant pointer-events-none" />
          <input
            type="search"
            aria-label="Search audit logs"
            placeholder="Search actor, event, detail or IP"
            value={q}
            onChange={(e) => set('q', e.target.value)}
            className={cn(fieldClass, 'border-light-outline pl-9 py-1.5')}
          />
        </div>
        <select aria-label="Event type" value={type} onChange={(e) => set('type', e.target.value)} className={cn(fieldClass, 'border-light-outline py-1.5 sm:w-56')}>
          <option value="">All event types</option>
          {(Object.keys(auditTypes) as AuditType[]).map((t) => (
            <option key={t} value={t}>
              {auditTypes[t]} ({rows.filter((r) => r.type === t).length})
            </option>
          ))}
        </select>
      </div>

      <div className={cn(panelClass, 'overflow-x-auto')}>
        <table className="w-full text-left border-collapse min-w-[880px]">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={thClass}>Timestamp</th>
              <th className={thClass}>Actor</th>
              <th className={thClass}>Event</th>
              <th className={thClass}>Target / Detail</th>
              <th className={thClass}>Source IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {shown.map((r) => (
              <tr key={r.id} className={cn(!!r.at && 'bg-light-primary-container/30')}>
                <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface-variant whitespace-nowrap">
                  {r.label}
                  {!!r.at && <span className="block font-body text-body-sm text-light-primary">This session</span>}
                </td>
                <td className="px-4 py-3.5 font-label text-label-md text-light-on-surface whitespace-nowrap">{r.actor}</td>
                <td className="px-4 py-3.5">
                  <span className={cn('px-2 py-0.5 rounded font-label text-label-sm whitespace-nowrap', auditTone[r.type])}>{r.event}</span>
                </td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface">
                  {r.to ? (
                    <Link to={r.to} className="hover:underline hover:text-light-primary">
                      {r.detail}
                    </Link>
                  ) : (
                    r.detail
                  )}
                </td>
                <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface-variant whitespace-nowrap">{r.ip}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-body text-body-md text-light-on-surface-variant">
                  No events match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-body text-body-sm text-light-on-surface-variant">
        Showing {shown.length} of {rows.length} events. Times are UTC; events from this session use your local clock. Workflow approvals come from Automate and credential rotations from Connect.
      </p>
    </AdminPage>
  )
}
