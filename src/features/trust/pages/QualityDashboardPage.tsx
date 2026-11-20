import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { domains, passRateByDay } from '../data'

/** Days below this pass rate are drawn in the warning colour. */
const WARN_BELOW = 90

/** Data quality dashboard (designed: trust_data_quality_dashboard). */
export function QualityDashboardPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Quality dashboard' }])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Data quality dashboard</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            Validation check pass rates across business domains over the last 7 days.
          </p>
        </div>
        <Link
          to="/trust/rules"
          className="px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg"
        >
          Manage quality rules
        </Link>
      </div>

      {/* 7-day pass rate chart */}
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-light-outline-variant pb-3">
          <div>
            <h2 className="font-title text-title-lg text-light-on-surface">Daily check pass rate</h2>
            <p className="font-body text-body-sm text-light-on-surface-variant">128 automated rules evaluated every sync cycle</p>
          </div>
          <span className="font-label text-label-md text-light-primary tabular-nums">125 / 128 passing today</span>
        </header>
        <ul className="h-44 flex items-end gap-4 pt-4" aria-label="Daily check pass rate, last 7 days">
          {passRateByDay.map((d) => (
            <li key={d.day} className="group flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div className="relative flex-1 w-full flex items-end">
                <div
                  className={cn('w-full rounded-sm', d.pct < WARN_BELOW ? 'bg-warning' : 'bg-light-primary')}
                  style={{ height: `${d.pct}%` }}
                  title={`${d.day}: ${d.pct}% passing`}
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1 text-center font-label text-label-sm text-light-on-primary tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-state-change"
                >
                  {d.pct}%
                </span>
              </div>
              <span className="font-label text-label-sm text-light-on-surface-variant">
                {d.day}
                <span className="sr-only">: {d.pct}% passing</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Domain breakdown */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter-md">
        {domains.map((d) => (
          <article key={d.name} className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-title text-title-md text-light-on-surface">{d.name}</span>
              <StatusBadge tone={d.tone} compact>
                {d.badge}
              </StatusBadge>
            </div>
            <p className="font-headline text-headline-md text-light-on-surface tabular-nums">
              {d.passing} / {d.total}
            </p>
            <p className="font-body text-body-sm text-light-on-surface-variant">{d.note}</p>
          </article>
        ))}
      </section>
    </>
  )
}
