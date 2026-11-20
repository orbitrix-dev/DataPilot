import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { KpiTile } from '../components/KpiTile'
import { Panel } from '../components/Panel'
import { agingBuckets, headline, receivables, type ReceivableRow } from '../data'
import { usd } from '../format'
import { useInsightsTrust } from '../trustLink'

const bucketClass = { success: 'text-success', neutral: undefined, warning: 'text-warning', error: 'text-error' } as const

const overdueClass = (r: ReceivableRow) => (r.oldestDays > 90 ? 'text-error' : r.oldestDays > 60 ? 'text-warning' : '')

const columns: Column<ReceivableRow>[] = [
  { key: 'customer', header: 'Customer', cellClassName: 'font-title text-title-md text-light-on-surface', cell: (r) => r.customer },
  { key: 'balance', header: 'Total balance', align: 'right', cellClassName: 'tabular-nums', cell: (r) => usd(r.balance) },
  {
    key: 'overdue',
    header: 'Overdue amount',
    align: 'right',
    cell: (r) => <span className={cn('tabular-nums', overdueClass(r))}>{usd(r.overdue)}</span>,
  },
  { key: 'oldest', header: 'Oldest invoice', align: 'right', cellClassName: 'tabular-nums', cell: (r) => `${r.oldestDays} days` },
]

/** Receivables analytics (designed: insights_receivables_analytics). */
export function ReceivablesAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Receivables analytics' }])
  const trust = useInsightsTrust()
  const rows = [...receivables].sort((a, b) => b.overdue - a.overdue)

  return (
    <>
      <PageHeader
        title="Receivables analytics"
        description="Which wholesale accounts have overdue invoices, and how is cash collection trending?"
      />

      {trust.invoicesUnderReview && (
        <div
          role="status"
          className="p-4 rounded-md bg-light-surface border border-warning flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <Icon name="warning" className="text-warning" />
            <p className="font-body text-body-sm text-light-on-surface">
              <strong>Trust notice ({trust.invoiceIncidentId}):</strong> 14 duplicate invoice records (~$18,450) are currently under
              review in <code className="font-mono text-mono-sm">public.invoices</code>.
            </p>
          </div>
          <Link
            to={`/trust/incidents/${trust.invoiceIncidentId}`}
            className="font-label text-label-md text-light-primary hover:underline"
          >
            Inspect incident →
          </Link>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-gutter-md">
        <KpiTile kpi={{ label: 'Total outstanding', value: usd(headline.outstanding), size: 'md' }} />
        {agingBuckets.map((b) => (
          <KpiTile key={b.label} kpi={{ label: b.label, value: usd(b.value), valueClass: bucketClass[b.tone], size: 'md' }} />
        ))}
      </section>

      <Panel
        flush
        title="Customer-wise outstanding & overdue invoices"
        aside={
          <Link to="/insights/reports/receivables-aging" className="font-label text-label-md text-light-primary hover:underline">
            Aging report
          </Link>
        }
      >
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.customer} />
      </Panel>
    </>
  )
}
