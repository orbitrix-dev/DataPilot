import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { BarChart } from '../components/BarChart'
import { Panel } from '../components/Panel'
import { customers, headline, monthlyTrend, products, regions } from '../data'
import { growthPct, signedPct, usd } from '../format'

const TOP_N = 3

function TopList({ title, to, linkLabel, rows }: { title: string; to: string; linkLabel: string; rows: { name: string; value: number }[] }) {
  return (
    <Panel
      flush
      title={title}
      aside={
        <Link to={to} className="font-label text-label-md text-light-primary hover:underline">
          {linkLabel}
        </Link>
      }
    >
      <table className="w-full text-left border-collapse">
        <caption className="sr-only">{title}</caption>
        <tbody className="divide-y divide-light-outline-variant">
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row" className="px-4 py-3 font-body text-body-sm font-normal text-light-on-surface">
                {r.name}
              </th>
              <td className="px-4 py-3 text-right tabular-nums font-label text-label-md">{usd(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

/** Sales analytics (designed: insights_sales_analytics). */
export function SalesAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Sales analytics' }])
  const growth = growthPct(headline.revenue, headline.priorRevenue)
  const total = regions.reduce((s, r) => s + r.revenue, 0)

  return (
    <>
      <PageHeader
        title="Sales analytics"
        description="Which products, wholesale accounts, and regions are driving revenue growth?"
        actions={
          <StatusBadge tone="success" size="md">
            Source: PostgreSQL ERP · Verified
          </StatusBadge>
        }
      />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter-md">
        <Panel
          className="lg:col-span-7"
          title="Revenue & order trend (vs prior period)"
          aside={<span className="font-label text-label-md text-success tabular-nums">{signedPct(growth)} vs prior 30d</span>}
        >
          <BarChart
            label="Rolling 30-day revenue by month"
            max={3_024_000}
            bars={monthlyTrend.map((m) => ({
              label: m.label,
              value: m.value,
              display: `$${(m.value / 1_000_000).toFixed(2)}M`,
              detail: `${m.orders.toLocaleString('en-US')} orders`,
            }))}
          />
        </Panel>

        <Panel className="lg:col-span-5" title="Sales by region">
          <ul className="flex flex-col gap-3">
            {regions.map((r) => {
              const share = Math.round((r.revenue / total) * 100)
              return (
                <li key={r.name}>
                  <div className="flex justify-between gap-2 font-body text-body-sm text-light-on-surface mb-1">
                    <span>{r.name}</span>
                    <span className="tabular-nums font-label">
                      {usd(r.revenue)} ({share}%)
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full bg-light-surface-container"
                    role="meter"
                    aria-label={`${r.name} share of revenue`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={share}
                  >
                    <div className="h-full bg-light-primary rounded-full" style={{ width: `${share}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter-md">
        <TopList
          title="Top products"
          to="/insights/products"
          linkLabel="All products"
          rows={products.slice(0, TOP_N).map((p) => ({ name: p.name, value: p.revenue }))}
        />
        <TopList
          title="Top wholesale customers"
          to="/insights/customers"
          linkLabel="All customers"
          rows={customers.slice(0, TOP_N).map((c) => ({ name: c.name, value: c.revenue90d }))}
        />
      </section>
    </>
  )
}
