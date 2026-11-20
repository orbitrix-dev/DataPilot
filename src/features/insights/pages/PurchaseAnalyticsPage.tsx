import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { KpiTile } from '../components/KpiTile'
import { Panel } from '../components/Panel'
import { purchaseStats, suppliers, type Supplier } from '../data'
import { pct, usd } from '../format'

/** On-time rate below this is shown as a warning. */
const ON_TIME_TARGET = 90

const columns: Column<Supplier>[] = [
  { key: 'name', header: 'Supplier', cell: (s) => s.name },
  { key: 'spend', header: '30d Spend', align: 'right', cellClassName: 'tabular-nums', cell: (s) => usd(s.spend30d) },
  {
    key: 'ontime',
    header: 'On-time %',
    align: 'right',
    cell: (s) => (
      <span className={cn('tabular-nums', s.onTimePct >= ON_TIME_TARGET ? 'text-success' : 'text-warning')}>{pct(s.onTimePct)}</span>
    ),
  },
  { key: 'lead', header: 'Avg lead time', align: 'right', cellClassName: 'tabular-nums', cell: (s) => `${s.leadTimeDays.toFixed(1)} days` },
]

/** Purchase analytics (designed: insights_purchase_analytics). */
export function PurchaseAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Purchase analytics' }])
  return (
    <>
      <PageHeader title="Purchase analytics" description="Are suppliers delivering on time and within contracted unit costs?" />

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        <KpiTile kpi={{ label: 'Monthly PO spend', value: usd(purchaseStats.poSpend) }} />
        <KpiTile kpi={{ label: 'Supplier on-time rate', value: pct(purchaseStats.onTimePct), valueClass: 'text-success' }} />
        <KpiTile kpi={{ label: 'Avg supplier lead time', value: `${purchaseStats.leadTimeDays} days` }} />
      </section>

      <Panel
        flush
        title="Top suppliers by spend & reliability"
        aside={<span className="font-body text-body-sm text-light-on-surface-variant">On-time target: {ON_TIME_TARGET}%</span>}
      >
        <DataTable columns={columns} rows={suppliers} rowKey={(s) => s.name} />
      </Panel>
    </>
  )
}
