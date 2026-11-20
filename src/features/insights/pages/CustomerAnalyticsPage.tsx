import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { KpiTile } from '../components/KpiTile'
import { Panel } from '../components/Panel'
import { useSort } from '../components/useSort'
import { customers, customerStats, type Customer } from '../data'
import { pct, usd } from '../format'

const accessors = {
  name: (c: Customer) => c.name,
  orders: (c: Customer) => c.orders90d,
  aov: (c: Customer) => c.aov,
  revenue: (c: Customer) => c.revenue90d,
}

/** Customer analytics (designed: insights_customer_analytics). */
export function CustomerAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Customer analytics' }])
  const { sorted, header, ariaSort } = useSort(customers, accessors, { key: 'revenue', dir: 'desc' })

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: header('name', 'Account'),
      ariaSort: ariaSort('name'),
      cellClassName: 'font-title text-title-md text-light-on-surface',
      cell: (c) => c.name,
    },
    {
      key: 'orders',
      header: header('orders', 'Orders (90d)', 'right'),
      ariaSort: ariaSort('orders'),
      align: 'right',
      cellClassName: 'tabular-nums',
      cell: (c) => c.orders90d,
    },
    {
      key: 'aov',
      header: header('aov', 'Avg order value', 'right'),
      ariaSort: ariaSort('aov'),
      align: 'right',
      cellClassName: 'tabular-nums',
      cell: (c) => usd(c.aov),
    },
    {
      key: 'revenue',
      header: header('revenue', '90d Revenue', 'right'),
      ariaSort: ariaSort('revenue'),
      align: 'right',
      cellClassName: 'tabular-nums',
      cell: (c) => usd(c.revenue90d),
    },
  ]

  return (
    <>
      <PageHeader
        title="Customer analytics"
        description="Which wholesale buyers reorder consistently, and where is account concentration risk?"
      />

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        <KpiTile kpi={{ label: 'Active wholesale accounts', value: String(customerStats.activeAccounts) }} />
        <KpiTile kpi={{ label: '90-day repeat order rate', value: pct(customerStats.repeatRatePct), valueClass: 'text-success' }} />
        <KpiTile
          kpi={{
            label: 'Top 10 account share',
            value: pct(customerStats.top10SharePct),
            caption: 'Share of 30-day revenue',
          }}
        />
      </section>

      <Panel flush title="Wholesale account performance" aside={<span className="font-body text-body-sm text-light-on-surface-variant">Top {customers.length} accounts by revenue</span>}>
        <DataTable columns={columns} rows={sorted} rowKey={(c) => c.name} />
      </Panel>
    </>
  )
}
