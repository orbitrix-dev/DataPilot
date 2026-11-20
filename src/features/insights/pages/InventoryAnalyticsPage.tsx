import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { cn } from '../../../lib/cn'
import { DataTable, type Column } from '../../connect/components/DataTable'
import { EmptyState } from '../../connect/components/EmptyState'
import { StatusBadge } from '../../connect/components/StatusBadge'
import type { StatusTone } from '../../connect/status'
import { KpiTile } from '../components/KpiTile'
import { Panel } from '../components/Panel'
import { headline, inventoryStats, REORDER_DAYS, stock, type StockRow } from '../data'
import { usd } from '../format'
import { staleAge, useInsightsTrust } from '../trustLink'

type Indicator = { tone: StatusTone; label: string; textClass: string }

function indicator(r: StockRow): Indicator {
  if (r.daysOfCover < 7) return { tone: 'error', label: 'Reorder now', textClass: 'text-error' }
  if (r.daysOfCover < REORDER_DAYS) return { tone: 'warning', label: 'Low stock', textClass: 'text-warning' }
  if (r.daysOfCover > 90) return { tone: 'neutral', label: 'Overstocked', textClass: '' }
  return { tone: 'success', label: 'Healthy', textClass: '' }
}

type Filter = 'all' | 'reorder' | 'overstocked'
const filters: { id: Filter; label: string; match: (r: StockRow) => boolean }[] = [
  { id: 'all', label: 'All SKUs', match: () => true },
  { id: 'reorder', label: 'Needs reorder', match: (r) => r.daysOfCover < REORDER_DAYS },
  { id: 'overstocked', label: 'Overstocked', match: (r) => r.daysOfCover > 90 },
]

const columns: Column<StockRow>[] = [
  {
    key: 'sku',
    header: 'SKU & Product',
    cell: (r) => (
      <>
        <span className="font-mono text-mono-sm">{r.sku}</span> · {r.name}
      </>
    ),
  },
  { key: 'onhand', header: 'On hand', align: 'right', cellClassName: 'tabular-nums', cell: (r) => r.onHand },
  {
    key: 'cover',
    header: 'Days of cover',
    align: 'right',
    cell: (r) => <span className={cn('tabular-nums', indicator(r).textClass)}>{r.daysOfCover} days</span>,
  },
  { key: 'velocity', header: 'Velocity', cell: (r) => r.velocity },
  {
    key: 'indicator',
    header: 'Reorder indicator',
    align: 'right',
    cell: (r) => <StatusBadge tone={indicator(r).tone}>{indicator(r).label}</StatusBadge>,
  },
]

/** Inventory analytics (designed: insights_inventory_analytics). */
export function InventoryAnalyticsPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Inventory analytics' }])
  const trust = useInsightsTrust()
  const [filter, setFilter] = useState<Filter>('all')
  const rows = stock.filter(filters.find((f) => f.id === filter)!.match)

  return (
    <>
      <PageHeader
        title="Inventory analytics"
        description="Which SKUs face stock-out risk, tie up working capital, or need immediate reordering?"
        actions={
          trust.stockStale ? (
            <Link to="/trust/freshness" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary">
              <StatusBadge tone="warning" size="md">
                Trust: Warehouse feed {staleAge(trust.stockLastUpdated)} stale
              </StatusBadge>
            </Link>
          ) : (
            <StatusBadge tone="success" size="md">
              Trust: Warehouse feed on time
            </StatusBadge>
          )
        }
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter-md">
        <KpiTile kpi={{ label: 'Inventory valuation', value: usd(headline.inventoryValue) }} />
        <KpiTile kpi={{ label: 'Fast-moving SKUs', value: String(inventoryStats.fastMoving), valueClass: 'text-success' }} />
        <KpiTile kpi={{ label: 'Slow-moving (>90d)', value: String(inventoryStats.slowMoving), valueClass: 'text-warning' }} />
        <KpiTile kpi={{ label: 'Stock-out risk', value: `${headline.lowStockSkus} SKUs`, valueClass: 'text-error' }} />
      </section>

      <Panel
        flush
        title="Reorder & stock-out risk indicators"
        aside={<span className="font-body text-body-sm text-light-on-surface-variant">Threshold: &lt; {REORDER_DAYS} days of cover</span>}
      >
        <div className="px-5 py-3 border-b border-light-outline-variant flex flex-wrap gap-2" role="group" aria-label="Filter SKUs">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'px-3 py-1.5 rounded border font-label text-label-md tabular-nums transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
                filter === f.id
                  ? 'border-light-primary bg-light-primary-container text-light-on-primary-container'
                  : 'border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container',
              )}
            >
              {f.label} ({stock.filter(f.match).length})
            </button>
          ))}
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.sku}
          empty={<EmptyState icon="inventory_2" title="No SKUs match this filter" />}
        />
      </Panel>
      {trust.stockStale && (
        <p className="font-body text-body-sm text-light-on-surface-variant">
          Stock counts are from the last warehouse export ({trust.stockLastUpdated}). Days of cover may be lower than shown.
        </p>
      )}
    </>
  )
}
