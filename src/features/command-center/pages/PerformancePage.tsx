import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { TrustChip } from '../../insights/components/TrustChip'
import { PERIOD_LABEL } from '../../insights/data'
import { pct, signedPct, usd } from '../../insights/format'
import type { TrustDependency } from '../../insights/reports'
import { CCHeader, CCTabs, linkClass } from '../components/parts'
import { figures, useCommandCenter } from '../signals'

type Row = {
  metric: string
  value: string
  change: string
  changeClass?: string
  dependsOn: TrustDependency
  source: string
  to: string
  linkLabel: string
}

const rows: Row[] = [
  {
    metric: 'Revenue (30 days)',
    value: usd(figures.revenue),
    change: `${signedPct(figures.revenueGrowthPct)} (+${usd(figures.revenueDelta)}) vs prior 30 days`,
    changeClass: 'text-success',
    dependsOn: 'none',
    source: 'public.orders',
    to: '/insights/sales',
    linkLabel: 'Sales analytics',
  },
  {
    metric: 'Orders (30 days)',
    value: figures.orders.toLocaleString('en-US'),
    change: `${signedPct(figures.orderGrowthPct)} vs prior 30 days`,
    changeClass: 'text-success',
    dependsOn: 'none',
    source: 'public.orders',
    to: '/insights/sales',
    linkLabel: 'Sales analytics',
  },
  {
    metric: 'Invoiced revenue this week (Mon–Fri)',
    value: usd(figures.week.revenue),
    change: `${signedPct(-figures.week.dropPct)} vs 4-week average (${usd(figures.week.baseline)})`,
    changeClass: 'text-error',
    dependsOn: 'stock',
    source: 'public.invoices · warehouse.stock_levels',
    to: '/intelligence/answers/revenue-decline',
    linkLabel: 'Decline breakdown',
  },
  {
    metric: 'Gross margin (30 days)',
    value: pct(figures.grossMarginPct),
    change: 'Across 4 product categories',
    dependsOn: 'none',
    source: 'public.orders · public.sku_costs',
    to: '/insights/metrics?metric=gross-margin&by=category',
    linkLabel: 'Metric explorer',
  },
  {
    metric: 'Outstanding receivables',
    value: usd(figures.outstanding),
    change: `${usd(figures.overdue60)} over 60 days past due`,
    changeClass: 'text-warning',
    dependsOn: 'invoices',
    source: 'public.invoices',
    to: '/insights/receivables',
    linkLabel: 'Receivables',
  },
  {
    metric: 'Inventory value',
    value: usd(figures.inventoryValue),
    change: `${figures.belowLead.length} SKUs below supplier lead time`,
    changeClass: 'text-warning',
    dependsOn: 'stock',
    source: 'warehouse.stock_levels',
    to: '/insights/inventory',
    linkLabel: 'Inventory',
  },
]

const th = 'px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant'

/** Business performance summary (designed: command_center_business_performance). */
export function PerformancePage() {
  usePageChrome([{ label: 'Command Center', to: '/command-center' }, { label: 'Business performance' }])
  const { qualifies } = useCommandCenter()
  const qualified = rows.filter((r) => qualifies(r.dependsOn))

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <CCHeader
        title="Business performance summary"
        description="Core wholesale metrics with source freshness context and direct drill-downs into Insights."
      />
      <CCTabs />

      <div className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <span className="font-body text-body-sm text-light-on-surface-variant">{PERIOD_LABEL}</span>
          <span className={cn('font-body text-body-sm', qualified.length ? 'text-warning' : 'text-success')}>
            {qualified.length ? `${qualified.length} of ${rows.length} metrics qualified by Trust` : 'All metrics verified by Trust'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[760px]">
            <thead className="bg-light-surface-container-low border-b border-light-outline-variant">
              <tr>
                <th scope="col" className={th}>Metric</th>
                <th scope="col" className={cn(th, 'text-right')}>Current value</th>
                <th scope="col" className={th}>Period change</th>
                <th scope="col" className={th}>Trust status</th>
                <th scope="col" className={th}>Drill-down</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant font-body text-body-md text-light-on-surface">
              {rows.map((r) => (
                <tr key={r.metric} className="hover:bg-light-surface-container-low">
                  <th scope="row" className="px-4 py-3 font-label text-label-lg text-light-on-surface">
                    {r.metric}
                    <span className="block font-mono text-mono-sm text-light-on-surface-variant font-normal">{r.source}</span>
                  </th>
                  <td className="px-4 py-3 text-right font-title text-title-md tabular-nums">{r.value}</td>
                  <td className={cn('px-4 py-3 text-body-sm', r.changeClass ?? 'text-light-on-surface-variant')}>{r.change}</td>
                  <td className="px-4 py-3">
                    <TrustChip dependsOn={r.dependsOn} link />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={r.to} className={linkClass}>
                      {r.linkLabel} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
