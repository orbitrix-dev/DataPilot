import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { KpiCard } from '../components/KpiCard'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import { overviewKpis, type Connection, type Kpi } from '../data'
import { NOW_ISO, formatShortUtc } from '../format'
import { connectionStatusMeta } from '../status'
import { recordRun, useConnectState } from '../store'
import { useTimers } from '../useTimers'

const headerLink =
  'inline-flex items-center gap-2 px-3.5 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-lg'

function connectionHref(c: Connection) {
  return c.kind === 'file' ? '/connect/upload' : `/connect/connections/${c.id}`
}

/** Connect overview (designed: connect_overview). */
export function ConnectOverviewPage() {
  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Overview' }])
  const { connections } = useConnectState()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [retrying, setRetrying] = useState(false)
  const schedule = useTimers()

  const failed = connections.filter((c) => c.status === 'failed')
  const firstFailed = failed[0]

  const attentionKpi: Kpi = {
    label: 'Attention required',
    icon: failed.length ? 'error' : 'check_circle',
    iconClassName: failed.length ? 'text-error' : 'text-success',
    value: String(failed.length),
    caption: firstFailed
      ? `${firstFailed.sourceType} credential expired`
      : 'All connections healthy',
    captionClassName: failed.length ? 'text-error' : 'text-success',
  }
  const kpis = [...overviewKpis, attentionKpi]

  const q = query.trim().toLowerCase()
  const rows = q
    ? connections.filter((c) =>
        [c.name, c.endpoint, c.sourceType, connectionStatusMeta[c.status].label].some((v) => v.toLowerCase().includes(q)),
      )
    : connections

  const retry = (c: Connection) => {
    setRetrying(true)
    schedule(() => {
      setRetrying(false)
      recordRun({
        connectionId: c.id,
        source: c.name,
        status: 'failed',
        statusLabel: 'Failed (403)',
        records: 0,
        durationSeconds: 2,
        timestamp: NOW_ISO,
        trigger: 'Manual',
      })
      toast('Retry failed (403) — rotate credentials to restore the sync', 'error')
    }, 1400)
  }

  const columns: Column<Connection>[] = [
    {
      key: 'name',
      header: 'Connection',
      cell: (c) => (
        <>
          <Link to={connectionHref(c)} className="font-title text-title-md text-light-primary hover:underline">
            {c.name}
          </Link>
          <p className="font-mono text-mono-sm text-light-on-surface-variant">{c.endpoint}</p>
        </>
      ),
    },
    {
      key: 'type',
      header: 'Type & Access',
      cellClassName: 'font-body text-body-sm text-light-on-surface',
      cell: (c) => `${c.sourceType} · Read-only`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <StatusBadge tone={connectionStatusMeta[c.status].tone} dot>
          {connectionStatusMeta[c.status].label}
        </StatusBadge>
      ),
    },
    {
      key: 'records',
      header: 'Records processed',
      align: 'right',
      cellClassName: 'font-body text-body-md tabular-nums',
      cell: (c) => c.recordsLabel,
    },
    {
      key: 'last',
      header: 'Last successful sync',
      align: 'right',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant tabular-nums',
      cell: (c) => formatShortUtc(c.lastSync),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cell: (c) => (
        <Link
          to={connectionHref(c)}
          className={`font-label text-label-md hover:underline ${c.status === 'failed' ? 'text-error' : 'text-light-primary'}`}
        >
          {c.kind === 'file' ? 'Inspect' : c.status === 'failed' ? 'Fix' : 'Manage'}
        </Link>
      ),
    },
  ]

  return (
    <>
      {/* Page header & sub-nav */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-gutter-md">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Connect</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Manage read-only data connections, file uploads, and sync schedules across your business tools.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-gutter-sm">
          <Link to="/connect/health" className={headerLink}>
            <Icon name="monitor_heart" size={18} />
            <span>Connection health</span>
          </Link>
          <Link to="/connect/upload" className={headerLink}>
            <Icon name="upload_file" size={18} />
            <span>Upload files</span>
          </Link>
          <Link
            to="/connect/marketplace"
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg"
          >
            <Icon name="add" size={18} />
            <span>Add data source</span>
          </Link>
        </div>
      </div>

      {/* KPI summary row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter-md items-stretch">
        {kpis.map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </section>

      {/* Actionable error banner */}
      {firstFailed && (
        <div
          role="alert"
          className="bg-light-surface border border-error rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <span className="w-8 h-8 rounded bg-error-container text-on-error-container flex items-center justify-center shrink-0">
              <Icon name="error" size={18} />
            </span>
            <div>
              <p className="font-title text-title-md text-light-on-surface">{firstFailed.name} sync failed</p>
              <p className="font-body text-body-sm text-light-on-surface-variant">{firstFailed.issue}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/connect/connections/${firstFailed.id}?rotate=1`}
              className="px-3 py-1.5 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-md"
            >
              Rotate credentials
            </Link>
            <button
              type="button"
              onClick={() => retry(firstFailed)}
              disabled={retrying}
              className="px-3 py-1.5 rounded bg-error text-on-error hover:opacity-90 font-label text-label-md disabled:opacity-60"
            >
              {retrying ? 'Retrying…' : 'Retry sync'}
            </button>
          </div>
        </div>
      )}

      {/* Active connections table */}
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="p-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Filter connections..." label="Filter connections" />
            <Link
              to="/connect/history"
              className="px-3 py-1.5 rounded border border-light-outline text-light-on-surface hover:bg-light-surface-container font-label text-label-md"
            >
              View sync history
            </Link>
          </div>
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            {q
              ? `Showing ${rows.length} of ${connections.length} active connections`
              : `Showing ${connections.length} active connections`}
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          empty={
            <EmptyState title={q ? 'No connections match your filter' : 'No active connections'}>
              {q ? (
                <button type="button" onClick={() => setQuery('')} className="font-label text-label-md text-light-primary hover:underline">
                  Clear filter
                </button>
              ) : (
                <Link to="/connect/marketplace" className="font-label text-label-md text-light-primary hover:underline">
                  Add a data source
                </Link>
              )}
            </EmptyState>
          }
        />
      </section>
    </>
  )
}
