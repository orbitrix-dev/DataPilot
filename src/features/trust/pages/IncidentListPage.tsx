import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { formatShortUtc } from '../../connect/format'
import type { Incident } from '../data'
import { incidentStatusMeta, isOpen, severityMeta } from '../status'
import { useTrustState } from '../store'

/** Data incident list (designed: trust_data_incident_list). */
export function IncidentListPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Incidents' }])
  const { incidents } = useTrustState()
  const open = incidents.filter(isOpen)
  const critical = open.filter((i) => i.severity === 'critical').length
  const warning = open.length - critical

  const columns: Column<Incident>[] = [
    {
      key: 'title',
      header: 'ID & Title',
      cell: (i) => (
        <Link
          to={`/trust/incidents/${i.id}`}
          className={cn('font-title text-title-md hover:underline', isOpen(i) ? 'text-light-primary' : 'text-light-on-surface')}
        >
          {i.id}: {i.title}
        </Link>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (i) => <StatusBadge tone={severityMeta(i).tone}>{severityMeta(i).label}</StatusBadge>,
    },
    { key: 'dataset', header: 'Affected dataset', cellClassName: 'font-mono text-mono-sm', cell: (i) => i.dataset },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => (
        <span className={cn('font-label text-label-md', incidentStatusMeta[i.status].className)}>
          {incidentStatusMeta[i.status].label}
        </span>
      ),
    },
    {
      key: 'detected',
      header: 'First detected',
      align: 'right',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap',
      cell: (i) => formatShortUtc(i.firstDetected),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Data incidents</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Active and resolved reliability issues detected by the DataTrust engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {critical > 0 && (
            <StatusBadge tone="error" size="md">
              {critical} Critical
            </StatusBadge>
          )}
          {warning > 0 && (
            <StatusBadge tone="warning" size="md">
              {warning} Warning
            </StatusBadge>
          )}
          {open.length === 0 && (
            <StatusBadge tone="success" size="md">
              No open incidents
            </StatusBadge>
          )}
        </div>
      </div>
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <DataTable columns={columns} rows={incidents} rowKey={(i) => i.id} />
      </section>
    </>
  )
}
