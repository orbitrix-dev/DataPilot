import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { useTimers } from '../../connect/useTimers'
import type { FreshnessRow } from '../data'
import { freshnessMeta } from '../status'
import { markFresh, useTrustState } from '../store'

/** Freshness monitoring (designed: trust_freshness_monitoring). */
export function FreshnessPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Freshness monitoring' }])
  const { freshness } = useTrustState()
  const toast = useToast()
  const schedule = useTimers()
  const [refreshing, setRefreshing] = useState<string[]>([])

  const refresh = (row: FreshnessRow) => {
    setRefreshing((r) => [...r, row.dataset])
    schedule(() => {
      setRefreshing((r) => r.filter((d) => d !== row.dataset))
      markFresh(row.dataset, 'Just now (14:32 UTC)')
      toast(`${row.dataset} refreshed`)
    }, 1500)
  }

  const columns: Column<FreshnessRow>[] = [
    { key: 'dataset', header: 'Dataset', cellClassName: 'font-mono text-mono-sm', cell: (f) => f.dataset },
    { key: 'sla', header: 'Expected SLA', cellClassName: 'font-body text-body-sm', cell: (f) => f.sla },
    {
      key: 'updated',
      header: 'Last updated',
      cell: (f) => <span className={cn('font-body text-body-sm tabular-nums', freshnessMeta[f.status].textClass)}>{f.lastUpdated}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) => <StatusBadge tone={freshnessMeta[f.status].tone}>{freshnessMeta[f.status].label}</StatusBadge>,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cell: (f) => {
        if (f.status === 'breached' && f.connectionId) {
          return (
            <Link to={`/connect/connections/${f.connectionId}`} className="font-label text-label-md text-error hover:underline">
              Inspect connection
            </Link>
          )
        }
        const busy = refreshing.includes(f.dataset)
        return (
          <button
            type="button"
            onClick={() => refresh(f)}
            disabled={busy}
            aria-label={`${f.status === 'stale' ? 'Refresh now' : 'Refresh'}: ${f.dataset}`}
            className="font-label text-label-md text-light-primary hover:underline disabled:opacity-60 disabled:no-underline"
          >
            {busy ? 'Refreshing…' : f.status === 'stale' ? 'Refresh now' : 'Refresh'}
          </button>
        )
      },
    },
  ]

  return (
    <>
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Freshness monitoring</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          Track when each dataset was last updated against its expected SLA schedule.
        </p>
      </div>
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <DataTable columns={columns} rows={freshness} rowKey={(f) => f.dataset} hover={false} />
      </section>
    </>
  )
}
