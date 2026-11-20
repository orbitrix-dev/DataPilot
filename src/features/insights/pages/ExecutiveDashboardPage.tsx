import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Icon } from '../../../components/ui/Icon'
import { BarChart } from '../components/BarChart'
import { KpiTile, type Kpi } from '../components/KpiTile'
import { Panel } from '../components/Panel'
import { headline, PERIOD_LABEL, weeklyRevenue } from '../data'
import { growthPct, pct, signedPct, usd } from '../format'
import { staleAge, useInsightsTrust } from '../trustLink'

const secondaryLink =
  'px-3.5 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-md'
const primaryLink = 'px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-md'

const domainLinks = [
  { label: 'Sales analytics', to: '/insights/sales' },
  { label: 'Customer analytics', to: '/insights/customers' },
  { label: 'Product analytics', to: '/insights/products' },
  { label: 'Inventory analytics', to: '/insights/inventory' },
  { label: 'Purchase analytics', to: '/insights/purchases' },
  { label: 'Receivables analytics', to: '/insights/receivables' },
]

/** Executive dashboard (designed: insights_executive_dashboard). */
export function ExecutiveDashboardPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Executive dashboard' }])
  const trust = useInsightsTrust()

  const growth = growthPct(headline.revenue, headline.priorRevenue)
  const orderGrowth = growthPct(headline.orders, headline.priorOrders)
  const priorWeeklyAvg = headline.priorRevenue / 4

  const kpis: Kpi[] = [
    {
      label: 'Total revenue',
      value: usd(headline.revenue),
      badge: { tone: 'success', label: 'Verified' },
      caption: 'PostgreSQL ERP · 4m ago',
      to: '/insights/sales',
    },
    {
      label: 'Revenue growth',
      value: signedPct(growth),
      valueClass: 'text-success',
      badge: { tone: 'success', label: 'vs Prior 30d' },
      caption: `+${usd(headline.revenue - headline.priorRevenue)} net gain`,
      to: '/insights/sales',
    },
    {
      label: 'Orders',
      value: headline.orders.toLocaleString('en-US'),
      badge: { tone: 'success', label: 'Verified' },
      caption: `${signedPct(orderGrowth)} order volume`,
      to: '/insights/sales',
    },
    {
      label: 'Average order value',
      value: usd(headline.revenue / headline.orders),
      badge: { tone: 'success', label: 'Verified' },
      caption: 'Total revenue / orders',
      to: '/insights/metrics?metric=aov',
    },
    trust.invoicesUnderReview
      ? {
          label: 'Outstanding receivables',
          value: usd(headline.outstanding),
          badge: { tone: 'warning', label: `Trust: ${trust.invoiceIncidentId}` },
          caption: '14 duplicate invoices under review',
          captionClass: 'text-warning',
          flagged: true,
          to: '/insights/receivables',
        }
      : {
          label: 'Outstanding receivables',
          value: usd(headline.outstanding),
          badge: { tone: 'success', label: 'Verified' },
          caption: 'Duplicate invoices resolved',
          to: '/insights/receivables',
        },
    {
      label: 'Inventory value',
      value: usd(headline.inventoryValue),
      badge: trust.stockStale
        ? { tone: 'warning', label: `${staleAge(trust.stockLastUpdated)} stale` }
        : { tone: 'success', label: 'Verified' },
      caption: 'Landed cost across 2 warehouses',
      to: '/insights/inventory',
    },
    {
      label: 'Low-stock products',
      value: `${headline.lowStockSkus} SKUs`,
      valueClass: 'text-error',
      badge: { tone: 'error', label: 'Reorder' },
      caption: 'Below 14-day safety stock',
      to: '/insights/inventory',
    },
    {
      label: 'Gross margin',
      value: pct(headline.grossMarginPct),
      badge: { tone: 'success', label: 'ERP Cost' },
      caption: 'Derived from order lines & COGS',
      to: '/insights/metrics?metric=gross-margin',
    },
  ]

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description="How is wholesale revenue, inventory health, and cash collection performing this month?"
        actions={
          <>
            <span className="inline-flex items-center gap-2 px-3 py-2 rounded border border-light-outline-variant bg-light-surface font-label text-label-md tabular-nums text-light-on-surface">
              <Icon name="calendar_today" size={18} className="text-light-on-surface-variant" />
              {PERIOD_LABEL}
            </span>
            <Link to="/insights/reports" className={secondaryLink}>
              Reports library
            </Link>
            <Link to="/insights/metrics" className={primaryLink}>
              Metric explorer
            </Link>
          </>
        }
      />

      <section aria-label="Executive KPIs" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter-md items-stretch">
        {kpis.map((k) => (
          <KpiTile key={k.label} kpi={k} />
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter-md">
        <Panel
          className="lg:col-span-8"
          title={
            <div>
              <h2 className="font-title text-title-lg text-light-on-surface">Weekly wholesale revenue</h2>
              <p className="font-body text-body-sm text-light-on-surface-variant">Current 4 weeks vs. prior 4-week average</p>
            </div>
          }
          aside={
            <Link to="/insights/sales" className="font-label text-label-md text-light-primary hover:underline">
              Drill into Sales →
            </Link>
          }
        >
          <BarChart
            label="Weekly wholesale revenue, current 4 weeks"
            gapClass="gap-6 px-2"
            max={900_000}
            bars={weeklyRevenue.map((w) => ({ label: w.label, value: w.value, display: usd(w.value) }))}
            reference={{ value: priorWeeklyAvg, label: `Prior 4-week average: ${usd(priorWeeklyAvg)} per week` }}
          />
        </Panel>

        <nav
          aria-label="Explore by domain"
          className="lg:col-span-4 bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-3"
        >
          <h2 className="font-title text-title-lg text-light-on-surface">Explore by domain</h2>
          {domainLinks.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="p-3 rounded border border-light-outline-variant hover:border-light-primary flex items-center justify-between transition-colors duration-state-change"
            >
              <span className="font-label text-label-md text-light-on-surface">{d.label}</span>
              <Icon name="chevron_right" size={18} className="text-light-primary" />
            </Link>
          ))}
        </nav>
      </section>
    </>
  )
}
