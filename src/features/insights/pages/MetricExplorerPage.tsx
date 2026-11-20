import { Link, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { inputBase } from '../../connect/styles'
import { PERIOD_LABEL } from '../data'
import { dimensions, isDimensionId, isMetricId, metrics } from '../metrics'
import { useInsightsTrust } from '../trustLink'

const selectClass = cn(inputBase, 'text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary')

/** Metric explorer (designed: insights_metric_explorer). Selection is kept in the URL so views can be linked. */
export function MetricExplorerPage() {
  usePageChrome([{ label: 'Insights', to: '/insights' }, { label: 'Metric explorer' }])
  const [params, setParams] = useSearchParams()
  const trust = useInsightsTrust()

  const metricParam = params.get('metric')
  const byParam = params.get('by')
  const metric = metrics.find((m) => m.id === (isMetricId(metricParam) ? metricParam : 'gross-margin'))!
  const dimension = dimensions.find((d) => d.id === (isDimensionId(byParam) ? byParam : 'category'))!

  const update = (key: 'metric' | 'by', value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const rows = metric.breakdown[dimension.id]
  const unsupported = metric.unsupported?.[dimension.id]
  const max = rows ? Math.max(...rows.map((r) => r.value)) : 0
  const best = rows ? (metric.higherIsBetter ? max : Math.min(...rows.map((r) => r.value))) : 0
  const underReview = metric.usesInvoices && trust.invoicesUnderReview

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <PageHeader
        title="Metric explorer"
        description="Inspect governed metric definitions, formulas, and source lineage before slicing by dimension."
      />

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">Metric</span>
            <select className={selectClass} value={metric.id} onChange={(e) => update('metric', e.target.value)}>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">Break down by</span>
            <select className={selectClass} value={dimension.id} onChange={(e) => update('by', e.target.value)}>
              {dimensions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">Date range</span>
            <span className={cn(inputBase, 'text-body-md text-light-on-surface-variant border-light-outline-variant tabular-nums')}>
              {PERIOD_LABEL}
            </span>
          </div>
        </div>

        <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-1">
          <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Governed definition &amp; source</span>
          <p className="font-mono text-mono-sm text-light-on-surface break-words">{metric.formula}</p>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            Source:{' '}
            {metric.sources.map((s, i) => (
              <span key={s}>
                {i > 0 && ' + '}
                <code className="font-mono text-mono-sm">{s}</code>
              </span>
            ))}{' '}
            · Trust status:{' '}
            {underReview ? (
              <Link to={`/trust/incidents/${trust.invoiceIncidentId}`} className="text-warning font-label hover:underline">
                Under review ({trust.invoiceIncidentId})
              </Link>
            ) : (
              <span className="text-success font-label">Verified</span>
            )}
          </p>
        </div>
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-light-outline-variant pb-3">
          <h2 className="font-title text-title-md text-light-on-surface">
            {metric.label} by {dimension.label.toLowerCase()}
          </h2>
          <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
            Overall: <span className="text-light-on-surface">{metric.overall}</span>
          </span>
        </header>

        {rows ? (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.name}>
                <div className="flex flex-wrap justify-between gap-x-4 font-body text-body-sm mb-1">
                  <span className="text-light-on-surface">
                    {r.name}
                    {r.value === best && (
                      <span className="ml-2 font-label text-label-sm text-success">{metric.higherIsBetter ? 'Highest' : 'Fastest collection'}</span>
                    )}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-label text-light-on-surface">{r.display}</span>
                    <span className="text-light-on-surface-variant"> · {r.detail}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-light-surface-container" aria-hidden="true">
                  <div className="h-full bg-light-primary rounded-full" style={{ width: `${(r.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded bg-light-surface-container-low">
            <Icon name="info" className="text-info mt-0.5" />
            <p className="font-body text-body-sm text-light-on-surface-variant">{unsupported}</p>
          </div>
        )}
        {underReview && (
          <p className="font-body text-body-sm text-warning">
            Includes 14 duplicate invoices (~$18,450) under review. Figures may be slightly overstated until {trust.invoiceIncidentId} is
            resolved.
          </p>
        )}
      </section>
    </div>
  )
}
