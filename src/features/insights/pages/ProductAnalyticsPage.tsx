import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { Panel } from '../components/Panel'
import { useSort } from '../components/useSort'
import { headline, products, type Product } from '../data'
import { pct, usd } from '../format'

const accessors = {
  sku: (p: Product) => p.sku,
  name: (p: Product) => p.name,
  units: (p: Product) => p.unitsSold,
  revenue: (p: Product) => p.revenue,
  margin: (p: Product) => p.marginPct,
}

/** Margins at or above the company average read as healthy; well below it as a warning. */
const marginClass = (m: number) => (m >= headline.grossMarginPct ? 'text-success' : m < 18 ? 'text-warning' : '')

/** Product analytics (designed: insights_product_analytics). */
export function ProductAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Product analytics' }])
  const { sorted, header, ariaSort } = useSort(products, accessors, { key: 'revenue', dir: 'desc' })

  const columns: Column<Product>[] = [
    { key: 'sku', header: header('sku', 'SKU'), ariaSort: ariaSort('sku'), cellClassName: 'font-mono text-mono-sm', cell: (p) => p.sku },
    { key: 'name', header: header('name', 'Product'), ariaSort: ariaSort('name'), cell: (p) => p.name },
    {
      key: 'units',
      header: header('units', 'Units sold', 'right'),
      ariaSort: ariaSort('units'),
      align: 'right',
      cellClassName: 'tabular-nums',
      cell: (p) => p.unitsSold.toLocaleString('en-US'),
    },
    {
      key: 'revenue',
      header: header('revenue', 'Revenue', 'right'),
      ariaSort: ariaSort('revenue'),
      align: 'right',
      cellClassName: 'tabular-nums',
      cell: (p) => usd(p.revenue),
    },
    {
      key: 'margin',
      header: header('margin', 'Gross margin', 'right'),
      ariaSort: ariaSort('margin'),
      align: 'right',
      cell: (p) => <span className={cn('tabular-nums', marginClass(p.marginPct))}>{pct(p.marginPct)}</span>,
    },
  ]

  return (
    <>
      <PageHeader title="Product analytics" description="Which SKUs deliver the highest gross margin and unit velocity?" />
      <Panel
        flush
        title="SKU revenue & margin breakdown"
        aside={
          <Link to="/insights/metrics?metric=gross-margin&by=category" className="font-label text-label-md text-light-primary hover:underline">
            Margin by category
          </Link>
        }
      >
        <DataTable columns={columns} rows={sorted} rowKey={(p) => p.sku} />
      </Panel>
      <p className="font-body text-body-sm text-light-on-surface-variant">
        Margins at or above the {pct(headline.grossMarginPct)} company average are shown in green; below 18% in amber.
      </p>
    </>
  )
}
