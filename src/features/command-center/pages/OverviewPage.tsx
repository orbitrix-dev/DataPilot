import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { TrustChip } from '../../insights/components/TrustChip'
import { signedPct, usd } from '../../insights/format'
import type { TrustDependency } from '../../insights/reports'
import { useActivity } from '../activity'
import { ActivityRow, AlertCard, CCHeader, CCTabs, ChipLink, Eyebrow, Section, linkClass } from '../components/parts'
import { toneDot } from '../styles'
import { figures, useCommandCenter } from '../signals'

type Kpi = { label: string; value: string; valueClass?: string; caption: string; captionClass?: string; to: string; dependsOn: TrustDependency }

/** Executive Command Center (designed: command_center_overview). */
export function OverviewPage() {
  usePageChrome([{ label: 'Command Center' }])
  const cc = useCommandCenter()
  const activity = useActivity().slice(0, 4)
  const { reliability } = cc

  const kpis: Kpi[] = [
    {
      label: 'Revenue (30 days)',
      value: usd(figures.revenue),
      caption: `${signedPct(-figures.week.dropPct)} this week (vs 4-wk avg)`,
      captionClass: 'text-error',
      to: '/insights/sales',
      dependsOn: 'none',
    },
    {
      label: 'Revenue growth (30 days)',
      value: signedPct(figures.revenueGrowthPct),
      valueClass: 'text-success',
      caption: `${figures.orders.toLocaleString('en-US')} orders (${signedPct(figures.orderGrowthPct)})`,
      to: '/insights/sales',
      dependsOn: 'none',
    },
    {
      label: 'Outstanding receivables',
      value: usd(figures.outstanding),
      caption: `${usd(figures.overdue60)} over 60 days past due`,
      captionClass: 'text-warning',
      to: '/insights/receivables',
      dependsOn: 'invoices',
    },
    {
      label: 'Inventory value',
      value: usd(figures.inventoryValue),
      caption: `${figures.belowLead.length} SKUs below supplier lead time`,
      captionClass: 'text-warning',
      to: '/insights/inventory',
      dependsOn: 'stock',
    },
  ]

  const orders = reliability.orders
  const stock = reliability.stock

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader
        title="Executive Command Center"
        description="Daily briefing across wholesale performance, data reliability, and pending decisions."
        actions={
          <>
            <ChipLink to="/intelligence" primary>
              Ask Intelligence
            </ChipLink>
            <ChipLink to="/command-center/alerts">Alerts ({cc.alerts.count})</ChipLink>
          </>
        }
      />
      <CCTabs />

      <section aria-labelledby="cc-performance">
        <div className="flex items-center justify-between mb-3">
          <h2 id="cc-performance" className="font-title text-title-md text-light-on-surface">
            Business performance (last 30 days)
          </h2>
          <Link to="/command-center/performance" className={linkClass}>
            Full breakdown →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k) => (
            <Link
              key={k.label}
              to={k.to}
              className="bg-light-surface border border-light-outline-variant hover:border-light-primary rounded-md p-4 flex flex-col transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-label text-label-md text-light-on-surface-variant">{k.label}</span>
                {k.dependsOn !== 'none' && cc.qualifies(k.dependsOn) && <TrustChip dependsOn={k.dependsOn} />}
              </div>
              <p className={cn('font-headline text-headline-md mt-1.5 tabular-nums', k.valueClass ?? 'text-light-on-surface')}>{k.value}</p>
              <span className={cn('font-body text-body-sm mt-1 block', k.captionClass ?? 'text-light-on-surface-variant')}>{k.caption}</span>
            </Link>
          ))}
        </div>
      </section>

      <section
        aria-label="Data reliability"
        className="bg-light-surface border border-light-outline-variant rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-3">
          <div>
            <Eyebrow>Data reliability</Eyebrow>
            <p className="font-title text-title-md text-light-on-surface mt-0.5 flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full inline-block', toneDot[reliability.tone])} aria-hidden="true" />
              <span>
                {reliability.score} indicative · {reliability.label}
              </span>
            </p>
          </div>
          <div className="xl:pl-6 xl:border-l border-light-outline-variant">
            <Eyebrow>Last successful update</Eyebrow>
            <p className="font-body text-body-md text-light-on-surface mt-0.5">
              Orders {orders?.lastUpdated.replace(/\s*\(.*\)$/, '')} ·{' '}
              <span className={stock?.status !== 'on-time' ? 'text-warning' : undefined}>Warehouse stock {stock?.lastUpdated.replace(/\s*\(.*\)$/, '')}</span>
            </p>
          </div>
          <div className="xl:pl-6 xl:border-l border-light-outline-variant">
            <Eyebrow>Active incidents</Eyebrow>
            <p className={cn('font-body text-body-md mt-0.5', cc.openIncidents.length ? 'text-error' : 'text-success')}>
              {cc.openIncidents.length ? `${cc.openIncidents.length} open (${cc.openIncidents.map((i) => i.id).join(', ')})` : 'None open'}
            </p>
          </div>
          <div className="xl:pl-6 xl:border-l border-light-outline-variant">
            <Eyebrow>Affected reports</Eyebrow>
            <p className="font-body text-body-md text-light-on-surface mt-0.5">
              {cc.qualifiedReports.length ? `${cc.qualifiedReports.length} ${cc.qualifiedReports.length === 1 ? 'report' : 'reports'} qualified` : 'None qualified'}
            </p>
          </div>
        </div>
        <ChipLink to="/trust">Inspect in Trust →</ChipLink>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Priority alerts"
          aside={
            <Link to="/command-center/alerts" className={linkClass}>
              View all →
            </Link>
          }
          className="gap-4"
        >
          <div className="flex flex-col gap-2">
            <Eyebrow>Business risks</Eyebrow>
            {cc.alerts.business.map((a) => (
              <AlertCard key={a.id} alert={a} compact />
            ))}
          </div>
          <div className="flex flex-col gap-2 pt-3 border-t border-light-outline-variant">
            <Eyebrow>Technical data incidents</Eyebrow>
            {cc.alerts.technical.length ? (
              cc.alerts.technical.map((a) => <AlertCard key={a.id} alert={a} compact />)
            ) : (
              <p className="font-body text-body-sm text-success flex items-center gap-1.5">
                <Icon name="check_circle" size={16} /> No open incidents, failing sources or failed runs.
              </p>
            )}
          </div>
        </Section>

        <div className="flex flex-col gap-6 min-w-0">
          <Section
            title="Recommended actions"
            aside={
              <Link to="/command-center/actions" className={linkClass}>
                All actions →
              </Link>
            }
          >
            {cc.openActions.length ? (
              <div className="divide-y divide-light-outline-variant">
                {cc.openActions.slice(0, 4).map((a) => (
                  <Link
                    key={a.id}
                    to={a.to}
                    className="py-2.5 flex items-center justify-between gap-3 hover:text-light-primary rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
                  >
                    <span className="font-body text-body-md">{a.title}</span>
                    <Icon name="arrow_forward" size={18} className="text-light-primary shrink-0" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="font-body text-body-md text-success">Every recommended action has been taken.</p>
            )}
          </Section>

          <Section
            title="Recent activity"
            aside={
              <Link to="/command-center/activity" className={linkClass}>
                Full log →
              </Link>
            }
          >
            <div className="divide-y divide-light-outline-variant">
              {activity.map((item) => (
                <ActivityRow key={item.id} item={item} compact />
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
