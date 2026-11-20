import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { useToast } from '../../../components/ui/Toast'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { btnPrimary } from '../../connect/styles'
import { useTimers } from '../../connect/useTimers'
import { impacts, type ImpactRow } from '../data'
import { isOpen } from '../status'
import { markNotified, useTrustState } from '../store'

/** Business impact analysis (designed: trust_business_impact_analysis). */
export function ImpactPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Business impact' }])
  const { incidents, notified } = useTrustState()
  const toast = useToast()
  const schedule = useTimers()
  const [sending, setSending] = useState(false)

  const openIds = new Set(incidents.filter(isOpen).map((i) => i.id))
  const pending = impacts.filter((r) => openIds.has(r.incidentId) && !notified.includes(r.incidentId))

  const notify = () => {
    setSending(true)
    schedule(() => {
      setSending(false)
      markNotified(pending.map((r) => r.incidentId))
      const owners = pending.map((r) => r.owner).join(' and ')
      toast(`Notified ${owners}`)
    }, 1000)
  }

  const columns: Column<ImpactRow>[] = [
    { key: 'report', header: 'Affected report / metric', cellClassName: 'font-title text-title-md text-light-on-surface', cell: (r) => r.report },
    {
      key: 'incident',
      header: 'Linked incident',
      cell: (r) => (
        <Link to={`/trust/incidents/${r.incidentId}`} className="font-mono text-mono-sm text-light-primary hover:underline">
          {r.incidentId}
        </Link>
      ),
    },
    {
      key: 'risk',
      header: 'Business risk',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant',
      cell: (r) => (openIds.has(r.incidentId) ? r.risk : 'No remaining risk; incident resolved'),
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (r) => (
        <div>
          <p className="font-body text-body-sm text-light-on-surface">{r.owner}</p>
          {notified.includes(r.incidentId) && (
            <p className="font-body text-body-sm text-light-on-surface-variant">Notified 14:32 UTC</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      cell: (r) =>
        openIds.has(r.incidentId) ? (
          <StatusBadge tone={r.openStatus.tone}>{r.openStatus.label}</StatusBadge>
        ) : (
          <StatusBadge tone="success">Resolved</StatusBadge>
        ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Business impact analysis</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Reports, KPIs, and scheduled deliveries affected by active data quality incidents.
          </p>
        </div>
        <button type="button" onClick={notify} disabled={sending || pending.length === 0} className={btnPrimary}>
          {sending ? 'Notifying…' : pending.length === 0 ? 'Report owners notified' : 'Notify report owners'}
        </button>
      </div>
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <DataTable columns={columns} rows={impacts} rowKey={(r) => r.report} hover={false} />
      </section>
    </>
  )
}
