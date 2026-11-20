import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { EmptyState } from '../../connect/components/EmptyState'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { overviewStatic, type Incident } from '../data'
import { isOpen, severityMeta } from '../status'
import { useTrustState } from '../store'

const subNavLink =
  'px-3 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-md'

type Metric = { label: string; value: string; valueClass: string; caption: string; to?: string; badge?: string }

/** Trust overview (designed: trust_overview). */
export function TrustOverviewPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Overview' }])
  const { incidents, freshness } = useTrustState()

  const open = incidents.filter(isOpen)
  const critical = open.filter((i) => i.severity === 'critical').length
  const warning = open.length - critical
  const stale = freshness.filter((f) => f.status !== 'on-time').length

  const metrics: Metric[] = [
    {
      label: 'Reliability score',
      value: overviewStatic.reliability,
      valueClass: 'text-light-on-surface',
      caption: 'Indicative summary of active checks',
      badge: 'Indicative',
    },
    {
      label: 'Healthy datasets',
      value: String(overviewStatic.healthyDatasets),
      valueClass: 'text-success',
      caption: 'Passing all checks',
      to: '/trust/quality',
    },
    {
      label: 'Needs attention',
      value: String(overviewStatic.needsAttention),
      valueClass: 'text-warning',
      caption: 'Schema or count drift',
      to: '/trust/schema',
    },
    {
      label: 'Failed quality checks',
      value: String(overviewStatic.failedChecks),
      valueClass: 'text-error',
      caption: overviewStatic.failedChecksCaption,
      to: '/trust/rules',
    },
    {
      label: 'Stale datasets',
      value: String(stale),
      valueClass: stale ? 'text-warning' : 'text-success',
      caption: stale ? 'Missed freshness SLA' : 'All datasets on time',
      to: '/trust/freshness',
    },
    {
      label: 'Active incidents',
      value: String(open.length),
      valueClass: open.length ? 'text-error' : 'text-success',
      caption: open.length
        ? [critical && `${critical} critical`, warning && `${warning} warning`].filter(Boolean).join(' · ')
        : 'No open incidents',
      to: '/trust/incidents',
    },
  ]

  const columns: Column<Incident>[] = [
    {
      key: 'incident',
      header: 'Incident',
      cell: (i) => (
        <Link to={`/trust/incidents/${i.id}`} className="font-title text-title-md text-light-primary hover:underline">
          {i.id}: {i.shortTitle}
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
      key: 'summary',
      header: 'Business summary',
      cellClassName: 'font-body text-body-sm text-light-on-surface-variant',
      cell: (i) => i.summary,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cellClassName: 'whitespace-nowrap',
      cell: (i) =>
        i.severity === 'critical' ? (
          <Link to={`/trust/incidents/${i.id}`} className="font-label text-label-md text-light-primary hover:underline">
            Investigate
          </Link>
        ) : (
          <Link to="/trust/impact" className="font-label text-label-md text-light-primary hover:underline">
            View impact
          </Link>
        ),
    },
  ]

  return (
    <>
      {/* Header & module sub-navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Trust overview</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Verify that your business data is accurate, complete, and up to date before making decisions.
          </p>
        </div>
        <nav aria-label="Trust" className="flex flex-wrap items-center md:justify-end gap-2">
          <Link to="/trust/quality" className={subNavLink}>
            Quality dashboard
          </Link>
          <Link to="/trust/rules" className={subNavLink}>
            Quality rules
          </Link>
          <Link to="/trust/lineage" className={subNavLink}>
            Lineage explorer
          </Link>
          <Link
            to="/trust/incidents"
            className="px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-md tabular-nums"
          >
            View incidents ({open.length})
          </Link>
        </nav>
      </div>

      {/* Key trust metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-gutter-md items-stretch">
        {metrics.map((m) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-1">
                <span className="font-label text-label-md text-light-on-surface-variant">{m.label}</span>
                {m.badge && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-info-container text-on-info-container font-label text-label-sm">
                    {m.badge}
                  </span>
                )}
              </div>
              <p className={cn('font-headline text-headline-lg tabular-nums', m.valueClass)}>{m.value}</p>
              <p className="font-body text-body-sm text-light-on-surface-variant">{m.caption}</p>
            </>
          )
          const base = 'bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-2'
          return m.to ? (
            <Link
              key={m.label}
              to={m.to}
              className={cn(
                base,
                'hover:border-light-outline hover:bg-light-surface-container-low transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
              )}
            >
              {body}
            </Link>
          ) : (
            <article key={m.label} className={base}>
              {body}
            </article>
          )
        })}
      </section>

      {/* Indicative score notice */}
      <div className="p-4 rounded-md bg-light-surface border border-light-outline-variant flex items-start gap-3">
        <Icon name="info" className="text-info mt-0.5" />
        <div>
          <p className="font-label text-label-md text-light-on-surface">About the indicative reliability score</p>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
            This indicative percentage reflects the ratio of passing quality rules and on-time freshness checks today. It is
            a directional health indicator rather than a weighted statistical model.
          </p>
        </div>
      </div>

      {/* Active incidents preview */}
      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <header className="px-5 py-4 border-b border-light-outline-variant flex items-center justify-between">
          <h2 className="font-title text-title-lg text-light-on-surface">Active data incidents</h2>
          <Link to="/trust/incidents" className="font-label text-label-md text-light-primary hover:underline">
            All incidents
          </Link>
        </header>
        <DataTable
          columns={columns}
          rows={open}
          rowKey={(i) => i.id}
          empty={<EmptyState icon="verified" title="No active data incidents">All quality and freshness checks are passing.</EmptyState>}
        />
      </section>
    </>
  )
}
