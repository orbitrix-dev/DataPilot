import { categories, receivables, REORDER_DAYS, stock, suppliers } from './data'
import { marginPct, pct, usd } from './format'

/**
 * Reports in the library. The first two are from the Stitch design; the
 * receivables and supplier reports were added in the same style.
 */

export type TrustDependency = 'none' | 'invoices' | 'stock'

export type ReportColumn = { header: string; align?: 'right'; mono?: boolean }
export type ReportCell = { text: string; tone?: 'success' | 'warning' | 'error' }

export type Report = {
  id: string
  title: string
  schedule: string
  sourceSystem: string
  tables: string[]
  dependsOn: TrustDependency
  columns: ReportColumn[]
  rows: ReportCell[][]
  total?: ReportCell[]
}

const marginTone = (m: number): ReportCell['tone'] => (m >= 24.8 ? 'success' : m < 18 ? 'warning' : undefined)

const totalRevenue = categories.reduce((s, c) => s + c.revenue, 0)
const totalCogs = categories.reduce((s, c) => s + c.cogs, 0)

export const reports: Report[] = [
  {
    id: 'gross-margin-sku-profitability',
    title: 'Monthly Gross Margin & SKU Profitability',
    schedule: 'Scheduled every 1st of month',
    sourceSystem: 'PostgreSQL ERP',
    tables: ['public.orders', 'public.sku_costs'],
    dependsOn: 'none',
    columns: [{ header: 'Category' }, { header: 'Revenue', align: 'right' }, { header: 'Landed COGS', align: 'right' }, { header: 'Gross margin', align: 'right' }],
    rows: categories.map((c) => {
      const m = marginPct(c.revenue, c.cogs)
      return [{ text: c.name }, { text: usd(c.revenue) }, { text: usd(c.cogs) }, { text: pct(m), tone: marginTone(m) }]
    }),
    total: [
      { text: 'All categories' },
      { text: usd(totalRevenue) },
      { text: usd(totalCogs) },
      { text: pct(marginPct(totalRevenue, totalCogs)) },
    ],
  },
  {
    id: 'weekly-low-stock-reorder',
    title: 'Weekly Low-Stock Reorder List',
    schedule: 'Scheduled Mondays 07:00 UTC',
    sourceSystem: 'MySQL Warehouse',
    tables: ['warehouse.stock_levels'],
    dependsOn: 'stock',
    columns: [{ header: 'SKU', mono: true }, { header: 'Product' }, { header: 'On hand', align: 'right' }, { header: 'Days of cover', align: 'right' }],
    rows: stock
      .filter((s) => s.daysOfCover < REORDER_DAYS)
      .map((s) => [
        { text: s.sku },
        { text: s.name },
        { text: s.onHand },
        { text: `${s.daysOfCover} days`, tone: s.daysOfCover < 7 ? 'error' : 'warning' },
      ]),
  },
  {
    id: 'receivables-aging',
    title: 'Receivables Aging by Customer',
    schedule: 'Scheduled daily 06:00 UTC',
    sourceSystem: 'PostgreSQL ERP',
    tables: ['public.invoices'],
    dependsOn: 'invoices',
    columns: [{ header: 'Customer' }, { header: 'Total balance', align: 'right' }, { header: 'Overdue amount', align: 'right' }, { header: 'Oldest invoice', align: 'right' }],
    rows: receivables.map((r) => [
      { text: r.customer },
      { text: usd(r.balance) },
      { text: usd(r.overdue), tone: r.oldestDays > 90 ? 'error' : r.oldestDays > 60 ? 'warning' : undefined },
      { text: `${r.oldestDays} days` },
    ]),
  },
  {
    id: 'supplier-scorecard',
    title: 'Supplier Delivery Scorecard',
    schedule: 'Scheduled every 1st of month',
    sourceSystem: 'PostgreSQL ERP',
    tables: ['public.purchase_orders'],
    dependsOn: 'none',
    columns: [{ header: 'Supplier' }, { header: '30d Spend', align: 'right' }, { header: 'On-time %', align: 'right' }, { header: 'Avg lead time', align: 'right' }],
    rows: suppliers.map((s) => [
      { text: s.name },
      { text: usd(s.spend30d) },
      { text: pct(s.onTimePct), tone: s.onTimePct >= 90 ? 'success' : 'warning' },
      { text: `${s.leadTimeDays.toFixed(1)} days` },
    ]),
  },
]

export const findReport = (id: string | undefined) => reports.find((r) => r.id === id)

/** CSV text for a report (header row, data rows, optional total row). */
export function reportCsv(r: Report): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [r.columns.map((c) => c.header), ...r.rows.map((row) => row.map((c) => c.text))]
  if (r.total) lines.push(r.total.map((c) => c.text))
  return lines.map((l) => l.map(esc).join(',')).join('\n')
}
