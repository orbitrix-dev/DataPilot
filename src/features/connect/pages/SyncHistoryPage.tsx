import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { useClickOutside } from '../../../lib/useClickOutside'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import type { SyncRun, SyncRunStatus } from '../data'
import { NOW_ISO, formatDuration, formatNumber, formatShortUtc } from '../format'
import { runStatusMeta } from '../status'
import { getConnection, recordRun, useConnectState } from '../store'
import { useTimers } from '../useTimers'

const DAY_MS = 24 * 60 * 60 * 1000

const ranges = [
  { id: '24h', label: 'Last 24 hours', days: 1 },
  { id: '7d', label: 'Nov 13 – Nov 20, 2026', days: 7 },
  { id: '30d', label: 'Oct 21 – Nov 20, 2026', days: 30 },
] as const
type RangeId = (typeof ranges)[number]['id']

const selectClass = 'pl-3 pr-8 py-1.5 rounded border border-light-outline bg-light-surface text-body-sm text-light-on-surface'

/** Sync history (designed: connect_sync_history) with search, status/source filters and retry. */
export function SyncHistoryPage() {
  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Sync history' }])
  const { runs } = useConnectState()
  const toast = useToast()
  const schedule = useTimers()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SyncRunStatus | 'all'>('all')
  const [range, setRange] = useState<RangeId>('7d')
  const [rangeOpen, setRangeOpen] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const rangeRef = useRef<HTMLDivElement>(null)
  useClickOutside(rangeRef, rangeOpen, () => setRangeOpen(false))

  const source = params.get('source') ?? 'all'
  const setSource = (v: string) => {
    const next = new URLSearchParams(params)
    if (v === 'all') next.delete('source')
    else next.set('source', v)
    setParams(next, { replace: true })
  }

  const sources = Array.from(new Map(runs.map((r) => [r.connectionId, r.source])).entries())
  const now = new Date(NOW_ISO).getTime()
  const rangeDef = ranges.find((r) => r.id === range) ?? ranges[1]
  const q = query.trim().toLowerCase()

  const filtered = runs.filter(
    (r) =>
      now - new Date(r.timestamp).getTime() <= rangeDef.days * DAY_MS &&
      (status === 'all' || r.status === status) &&
      (source === 'all' || r.connectionId === source) &&
      (!q || r.id.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)),
  )
  const hasFilters = q || status !== 'all' || source !== 'all'

  const clearFilters = () => {
    setQuery('')
    setStatus('all')
    setSource('all')
  }

  const retry = (run: SyncRun) => {
    setRetrying(run.id)
    schedule(() => {
      setRetrying(null)
      const conn = getConnection(run.connectionId)
      if (!conn || conn.status === 'failed') {
        recordRun({ ...run, status: 'failed', statusLabel: run.statusLabel ?? 'Failed', durationSeconds: 2, timestamp: NOW_ISO, trigger: 'Manual' })
        toast(`Retry of ${run.id} failed — ${conn?.issue ? 'credentials are still expired' : 'source unavailable'}`, 'error')
      } else {
        const records = 21740
        recordRun({ connectionId: run.connectionId, source: run.source, status: 'succeeded', records, durationSeconds: 58, timestamp: NOW_ISO, trigger: 'Manual' })
        toast(`Retry succeeded — ${formatNumber(records)} records processed`)
      }
    }, 1500)
  }

  const columns: Column<SyncRun>[] = [
    { key: 'id', header: 'Run ID', cellClassName: 'font-mono text-mono-sm', cell: (r) => r.id },
    { key: 'source', header: 'Source', cellClassName: 'font-body text-body-md', cell: (r) => r.source },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge tone={runStatusMeta[r.status].tone}>{r.statusLabel ?? runStatusMeta[r.status].label}</StatusBadge>,
    },
    { key: 'records', header: 'Records processed', align: 'right', cellClassName: 'tabular-nums', cell: (r) => formatNumber(r.records) },
    { key: 'duration', header: 'Duration', align: 'right', cellClassName: 'tabular-nums', cell: (r) => formatDuration(r.durationSeconds) },
    {
      key: 'ts',
      header: 'Timestamp',
      align: 'right',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap',
      cell: (r) => formatShortUtc(r.timestamp),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cell: (r) =>
        r.status === 'failed' ? (
          <button
            type="button"
            onClick={() => retry(r)}
            disabled={retrying !== null}
            className="font-label text-label-md text-error hover:underline disabled:opacity-50"
          >
            {retrying === r.id ? 'Retrying…' : 'Retry'}
          </button>
        ) : getConnection(r.connectionId) ? (
          <Link to={`/connect/connections/${r.connectionId}`} className="font-label text-label-md text-light-primary hover:underline">
            Details
          </Link>
        ) : (
          <span className="font-label text-label-md text-light-on-surface-variant">Removed</span>
        ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Sync history</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Audit trail of every scheduled and manual data ingestion run.
          </p>
        </div>
        <div ref={rangeRef} className="relative">
          <button
            type="button"
            onClick={() => setRangeOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={rangeOpen}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-light-outline bg-light-surface font-label text-label-md tabular-nums hover:bg-light-surface-container"
          >
            <Icon name="calendar_today" size={18} className="text-light-on-surface-variant" />
            <span>{rangeDef.label}</span>
          </button>
          {rangeOpen && (
            <ul
              role="listbox"
              aria-label="Date range"
              className="absolute right-0 mt-1 z-20 min-w-full bg-light-surface border border-light-outline rounded-md shadow-lg py-1"
            >
              {ranges.map((r) => (
                <li key={r.id} role="option" aria-selected={r.id === range}>
                  <button
                    type="button"
                    onClick={() => {
                      setRange(r.id)
                      setRangeOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 font-body text-body-sm tabular-nums whitespace-nowrap hover:bg-light-surface-container',
                      r.id === range ? 'text-light-primary' : 'text-light-on-surface',
                    )}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="p-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Search run ID or source..." label="Search sync runs" />
            <select value={status} onChange={(e) => setStatus(e.target.value as SyncRunStatus | 'all')} aria-label="Filter by status" className={selectClass}>
              <option value="all">All statuses</option>
              <option value="succeeded">Succeeded</option>
              <option value="partial">Slow</option>
              <option value="failed">Failed</option>
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" className={selectClass}>
              <option value="all">All sources</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="font-label text-label-md text-light-primary hover:underline px-2">
                Clear filters
              </button>
            )}
          </div>
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            {filtered.length} of {runs.length} runs
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          empty={
            <EmptyState icon="history" title="No sync runs match these filters">
              Widen the date range or{' '}
              <button type="button" onClick={clearFilters} className="font-label text-label-md text-light-primary hover:underline">
                clear filters
              </button>
              .
            </EmptyState>
          }
        />
      </section>
    </>
  )
}
