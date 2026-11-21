import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import type { RunOutcome } from '../data'
import { AutomateHeader, AutomateTabs, OutcomeBadge } from '../components/parts'
import { useAutomateState } from '../store'

const th = 'px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant'

type Filter = 'all' | RunOutcome

const filterLabels: Record<Filter, string> = {
  all: 'All',
  executed: 'Executed',
  failed: 'Failed',
  running: 'Running',
  test: 'Dry runs',
  rejected: 'Rejected',
}

/** Execution history (designed: automate_execution_history). */
export function HistoryPage() {
  usePageChrome([{ label: 'Automate', to: '/automate' }, { label: 'Execution history' }])
  const { runs, workflows } = useAutomateState()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const nameOf = (id: string) => workflows.find((w) => w.id === id)?.name ?? id
  const count = (f: Filter) => (f === 'all' ? runs.length : runs.filter((r) => r.outcome === f).length)
  const filters = (Object.keys(filterLabels) as Filter[]).filter((f) => f === 'all' || count(f) > 0)
  const q = query.trim().toLowerCase()
  const rows = runs.filter(
    (r) =>
      (filter === 'all' || r.outcome === filter) &&
      (!q || [r.id, r.requestId ?? '', nameOf(r.workflowId), r.approvedBy, r.summary].some((s) => s.toLowerCase().includes(q))),
  )

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        title="Execution history"
        description="Complete audit log of executed runs, rejected recommendations, dry-run tests, and retries."
      />
      <AutomateTabs />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by outcome">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1 rounded-full font-label text-label-md tabular-nums transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
                filter === f
                  ? 'bg-light-primary text-light-on-primary'
                  : 'bg-light-surface border border-light-outline-variant text-light-on-surface-variant hover:bg-light-surface-container',
              )}
            >
              {filterLabels[f]} ({count(f)})
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Icon name="search" size={18} className="text-light-on-surface-variant absolute left-3 top-2" />
          <label htmlFor="run-search" className="sr-only">
            Search runs
          </label>
          <input
            id="run-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search run, workflow or person..."
            className="w-full pl-9 pr-3 py-1.5 rounded border border-light-outline bg-light-surface font-body text-body-sm text-light-on-surface placeholder:text-light-on-surface-variant focus:border-light-primary focus:ring-0"
          />
        </div>
      </div>

      <div className="bg-light-surface border border-light-outline-variant rounded-md overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={th}>Run ID</th>
              <th className={th}>Workflow</th>
              <th className={th}>Decided by</th>
              <th className={th}>Outcome</th>
              <th className={th}>Timestamp</th>
              <th className={`${th} text-right`}>Logs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface whitespace-nowrap">{r.id}</td>
                <td className="px-4 py-3.5 min-w-[220px]">
                  <Link to={`/automate/workflows/${r.workflowId}`} className="font-label text-label-md text-light-on-surface hover:text-light-primary hover:underline">
                    {nameOf(r.workflowId)}
                  </Link>
                  <p className="font-body text-body-sm text-light-on-surface-variant">{r.summary}</p>
                </td>
                <td className={cn('px-4 py-3.5 font-body text-body-sm whitespace-nowrap', r.outcome === 'test' || r.approvedBy.startsWith('Pre') ? 'text-light-on-surface-variant' : 'text-light-on-surface')}>
                  {r.approvedBy}
                </td>
                <td className="px-4 py-3.5">
                  <OutcomeBadge outcome={r.outcome} />
                </td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap">{r.time}</td>
                <td className="px-4 py-3.5 text-right">
                  <Link to={`/automate/runs/${r.id}`} className="font-label text-label-md text-light-primary hover:underline whitespace-nowrap" aria-label={`Inspect ${r.id}`}>
                    Inspect →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center font-body text-body-md text-light-on-surface-variant">
                  No runs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
