import { categories, customerTiers, headline, regions } from './data'
import { marginPct, pct, usd } from './format'

/**
 * Governed metric definitions for the Metric explorer. Each breakdown is
 * computed from the same rows the analytics pages use, so the numbers agree.
 */

export type DimensionId = 'category' | 'region' | 'tier'

export const dimensions: { id: DimensionId; label: string }[] = [
  { id: 'category', label: 'Product category' },
  { id: 'region', label: 'Sales region' },
  { id: 'tier', label: 'Customer tier' },
]

export type MetricId = 'gross-margin' | 'aov' | 'dso'

export type BreakdownRow = { name: string; value: number; display: string; detail: string }

export type MetricDef = {
  id: MetricId
  label: string
  formula: string
  sources: string[]
  /** Overall value for the period. */
  overall: string
  /** When true, the metric's source is affected by the open INC-204 invoices incident. */
  usesInvoices: boolean
  /** Higher is better (controls which end of the bar list is highlighted). */
  higherIsBetter: boolean
  breakdown: Partial<Record<DimensionId, BreakdownRow[]>>
  /** Why a dimension is not offered, when it isn't. */
  unsupported?: Partial<Record<DimensionId, string>>
}

const DAYS = 30
const dso = (receivables: number, revenue: number) => receivables / (revenue / DAYS)

export const metrics: MetricDef[] = [
  {
    id: 'gross-margin',
    label: 'Gross Margin (%)',
    formula: '(SUM(order_line_revenue) - SUM(landed_cogs)) / SUM(order_line_revenue)',
    sources: ['public.orders', 'public.sku_costs'],
    overall: pct(headline.grossMarginPct),
    usesInvoices: false,
    higherIsBetter: true,
    breakdown: {
      category: categories.map((c) => {
        const m = marginPct(c.revenue, c.cogs)
        return { name: c.name, value: m, display: pct(m), detail: `${usd(c.revenue)} revenue` }
      }),
      region: regions.map((r) => ({
        name: r.name,
        value: r.marginPct,
        display: pct(r.marginPct),
        detail: `${usd(r.revenue)} revenue`,
      })),
      tier: customerTiers.map((t) => ({
        name: t.name,
        value: t.marginPct,
        display: pct(t.marginPct),
        detail: `${usd(t.revenue)} revenue`,
      })),
    },
  },
  {
    id: 'aov',
    label: 'Average Order Value ($)',
    formula: 'SUM(order_total) / COUNT(DISTINCT order_id)',
    sources: ['public.orders'],
    overall: usd(headline.revenue / headline.orders),
    usesInvoices: false,
    higherIsBetter: true,
    breakdown: {
      region: regions.map((r) => ({
        name: r.name,
        value: r.revenue / r.orders,
        display: usd(r.revenue / r.orders),
        detail: `${r.orders.toLocaleString('en-US')} orders`,
      })),
      tier: customerTiers.map((t) => ({
        name: t.name,
        value: t.revenue / t.orders,
        display: usd(t.revenue / t.orders),
        detail: `${t.orders.toLocaleString('en-US')} orders`,
      })),
    },
    unsupported: {
      category: 'One order can contain products from several categories, so order value cannot be split by category.',
    },
  },
  {
    id: 'dso',
    label: 'Days Sales Outstanding',
    formula: 'SUM(open_invoice_balance) / (SUM(invoiced_revenue_30d) / 30)',
    sources: ['public.invoices', 'public.orders'],
    overall: `${dso(headline.outstanding, headline.revenue).toFixed(1)} days`,
    usesInvoices: true,
    higherIsBetter: false,
    breakdown: {
      region: regions.map((r) => {
        const d = dso(r.receivables, r.revenue)
        return { name: r.name, value: d, display: `${d.toFixed(1)} days`, detail: `${usd(r.receivables)} outstanding` }
      }),
      tier: customerTiers.map((t) => {
        const d = dso(t.receivables, t.revenue)
        return { name: t.name, value: d, display: `${d.toFixed(1)} days`, detail: `${usd(t.receivables)} outstanding` }
      }),
    },
    unsupported: {
      category: 'Invoices are issued per order, not per product category, so receivables cannot be split by category.',
    },
  },
]

export const isMetricId = (v: string | null): v is MetricId => metrics.some((m) => m.id === v)
export const isDimensionId = (v: string | null): v is DimensionId => dimensions.some((d) => d.id === v)
