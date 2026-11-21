import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { connectionStatusMeta } from '../../connect/status'
import { useConnectState } from '../../connect/store'
import { pct, signedPct, usd } from '../../insights/format'
import { freshnessMeta } from '../../trust/status'
import { CCHeader, CCTabs, Section, linkClass } from '../components/parts'
import { toneText } from '../styles'
import { figures, useCommandCenter, type Tone } from '../signals'

type HealthRow = { label: string; value: string; tone: Tone; to?: string }

function Rows({ rows }: { rows: HealthRow[] }) {
  return (
    <dl className="divide-y divide-light-outline-variant">
      {rows.map((r) => (
        <div key={r.label} className="py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="font-body text-body-md text-light-on-surface-variant">{r.label}</dt>
          <dd className={cn('font-label text-label-lg text-right tabular-nums', toneText[r.tone])}>
            {r.to ? (
              <Link to={r.to} className="hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary">
                {r.value}
              </Link>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function summaryBadge(rows: HealthRow[], healthyLabel: string, issueLabel: (n: number) => string) {
  const errors = rows.filter((r) => r.tone === 'error').length
  const warnings = rows.filter((r) => r.tone === 'warning').length
  if (errors) return <StatusBadge tone="error" dot>{issueLabel(errors + warnings)}</StatusBadge>
  if (warnings) return <StatusBadge tone="warning" dot>{issueLabel(warnings)}</StatusBadge>
  return <StatusBadge tone="success" dot>{healthyLabel}</StatusBadge>
}

/** Business & data health (designed: command_center_business_health). */
export function HealthPage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Business health' }])
  const cc = useCommandCenter()
  const { connections } = useConnectState()

  const commercial: HealthRow[] = [
    { label: 'Revenue growth (30 days)', value: `${signedPct(figures.revenueGrowthPct)} vs prior 30 days`, tone: 'success', to: '/insights/sales' },
    {
      label: 'Sales momentum (this week)',
      value: `${signedPct(-figures.week.dropPct)} vs 4-wk avg (${figures.held.orders} Midwest orders held)`,
      tone: 'warning',
      to: '/intelligence/answers/revenue-decline',
    },
    {
      label: 'Receivables collection',
      value: `${pct(figures.overdueSharePct)} over 60 days (${usd(figures.overdue60)})`,
      tone: 'warning',
      to: '/insights/receivables',
    },
    { label: 'Inventory coverage', value: `${figures.belowLead.length} SKUs below lead time`, tone: 'warning', to: '/intelligence/answers/stockout-risk' },
    { label: 'Gross margin (30 days)', value: pct(figures.grossMarginPct), tone: 'neutral', to: '/insights/metrics?metric=gross-margin&by=category' },
  ]

  const pipeline: HealthRow[] = [
    { label: 'Indicative reliability', value: cc.reliability.score, tone: 'neutral', to: '/trust/quality' },
    ...cc.reliability.feeds.map<HealthRow>((f) => ({
      label: f.dataset,
      value: `${freshnessMeta[f.status].label} (${f.ago}${f.incident ? ` · ${f.incident}` : ''})`,
      tone: f.status === 'on-time' ? 'success' : f.status === 'stale' ? 'warning' : 'error',
      to: '/trust/freshness',
    })),
    {
      label: 'Open incidents',
      value: cc.openIncidents.length ? cc.openIncidents.map((i) => i.id).join(', ') : 'None',
      tone: cc.openIncidents.some((i) => i.severity === 'critical') ? 'error' : cc.openIncidents.length ? 'warning' : 'success',
      to: '/trust/incidents',
    },
    {
      label: 'Affected reports',
      value: cc.qualifiedReports.length ? `${cc.qualifiedReports.length} qualified` : 'None',
      tone: cc.qualifiedReports.length ? 'warning' : 'success',
      to: '/trust/impact',
    },
  ]

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader title="Business & data health" description="Side-by-side view of commercial operating health and underlying data pipeline reliability." />
      <CCTabs />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Commercial health" aside={summaryBadge(commercial, 'Healthy', () => 'Watch')}>
          <Rows rows={commercial} />
          <Link to="/insights" className={cn(linkClass, 'self-start')}>
            Open executive insights →
          </Link>
        </Section>

        <Section
          title="Data pipeline health"
          aside={summaryBadge(pipeline, 'Healthy', () =>
            cc.openIncidents.length ? `${cc.openIncidents.length} ${cc.openIncidents.length === 1 ? 'incident' : 'incidents'}` : 'Watch',
          )}
        >
          <Rows rows={pipeline} />
          <Link to="/trust" className={cn(linkClass, 'self-start')}>
            Open DataPilot Trust →
          </Link>
        </Section>
      </div>

      <Section
        title="Source connections"
        aside={
          <Link to="/connect/health" className={linkClass}>
            Connection health →
          </Link>
        }
      >
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {connections.map((c) => (
            <li key={c.id}>
              <Link
                to={`/connect/connections/${c.id}`}
                className="p-3 rounded border border-light-outline-variant hover:border-light-primary flex items-center justify-between gap-3 transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
              >
                <span className="min-w-0">
                  <span className="block font-label text-label-md text-light-on-surface truncate">{c.name}</span>
                  <span className="block font-body text-body-sm text-light-on-surface-variant truncate">{c.issue ?? c.endpoint}</span>
                </span>
                <StatusBadge tone={connectionStatusMeta[c.status].tone} dot>
                  {connectionStatusMeta[c.status].label}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
