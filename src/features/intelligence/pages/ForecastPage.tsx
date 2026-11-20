import { useState, type ReactNode } from 'react'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { usd, signedPct } from '../../insights/format'
import { FollowUps, SourceList, TextLink } from '../components/AnswerParts'
import { askPath, findAnswer, forecastFor, forecastObserved, observedOrders, observedTotal, type Horizon } from '../data'
import { useFreshness } from '../trust'

const horizons: Horizon[] = [30, 60, 90]

const k = (n: number) => `$${Math.round(n / 1000)}k`
const m = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`

/** Forecasting workspace (designed: intelligence_forecasting_workspace). */
export function ForecastPage() {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Forecasting workspace' }])
  const [horizon, setHorizon] = useState<Horizon>(30)
  const answer = findAnswer('forecast')!
  const f = forecastFor(horizon)
  const freshness = useFreshness('public.orders')
  const max = Math.max(...forecastObserved.map((w) => w.value), ...f.values) * 1.15
  const stock = findAnswer('stockout-risk')!
  const decline = findAnswer('revenue-decline')!
  const growth = findAnswer('growth-customers')!

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Pill className="bg-info-container text-on-info-container" icon="trending_up">
              Forecast (projected)
            </Pill>
            <Pill className="bg-success-container text-on-success-container" icon="verified">
              Observed baseline verified
            </Pill>
          </div>
          <h1 className="font-headline text-headline-md text-light-on-surface">Wholesale revenue &amp; demand forecast</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-0.5">
            Modelled from 16 weeks of observed wholesale order history in{' '}
            <span className="font-mono text-mono-sm text-light-on-surface">public.orders</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span id="horizon-label" className="font-label text-label-md text-light-on-surface-variant">
            Horizon:
          </span>
          <div role="radiogroup" aria-labelledby="horizon-label" className="inline-flex rounded border border-light-outline bg-light-surface p-0.5">
            {horizons.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={h === horizon}
                onClick={() => setHorizon(h)}
                className={cn(
                  'px-3 py-1 rounded font-label text-label-md transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
                  h === horizon ? 'bg-light-primary text-light-on-primary' : 'text-light-on-surface-variant hover:bg-light-surface-container',
                )}
              >
                {h} days
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-info-container border border-light-outline-variant rounded-md p-4 flex items-start gap-3">
        <Icon name="info" className="text-on-info-container shrink-0 mt-0.5" />
        <div>
          <p className="font-label text-label-lg text-on-info-container">Projected estimates — not observed actuals</p>
          <p className="font-body text-body-sm text-on-info-container mt-0.5">
            Values for Wk +1 to Wk +{f.weeks} are statistical forecasts generated from your authorized historical orders and
            seasonal weights. They carry an 80% confidence band of ±{f.band}% and assume no unscheduled supply disruptions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Observed (last 4 wks)" tag="Observed" tagClass="bg-light-surface-container text-light-on-surface-variant" value={usd(observedTotal)}>
          {observedOrders.toLocaleString('en-US')} fulfilled orders
        </MetricCard>
        <MetricCard
          label={`Projected (next ${horizon} days)`}
          tag="Forecast"
          value={usd(f.total)}
          valueClass="text-light-primary"
          highlight
        >
          80% band: {m(f.low)} – {m(f.high)}
        </MetricCard>
        <MetricCard label="Expected variance" tag="Forecast" value={signedPct(f.growth)}>
          vs. observed 4-week run rate · Q4 restock cycle
        </MetricCard>
        <MetricCard label="Baseline freshness" tag="Healthy" tagClass="bg-success-container text-on-success-container" value={freshness}>
          Sales &amp; Orders checks: 42/42 passing
        </MetricCard>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h2 className="font-title text-title-md text-light-on-surface">Weekly revenue: observed vs. forecast (projected)</h2>
            <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
              Solid bars represent verified actuals; dashed, outlined bars represent projected estimates.
            </p>
          </div>
          <div className="flex items-center gap-4 font-label text-label-sm text-light-on-surface shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-light-primary" aria-hidden="true" /> Observed actual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-info-container border-2 border-dashed border-light-primary" aria-hidden="true" />{' '}
              Forecast (projected)
            </span>
          </div>
        </div>

        <ul className="h-64 flex items-end gap-2 sm:gap-3 border-b border-light-outline-variant overflow-x-auto" aria-label="Weekly revenue, observed and forecast">
          {forecastObserved.map((w, i) => (
            <Column key={w.label} label={w.label} value={k(w.value)} pct={(w.value / max) * 100} current={i === forecastObserved.length - 1} sr={`${w.label} observed: ${usd(w.value)}`} />
          ))}
          {f.values.map((v, i) => (
            <Column key={i} label={`Wk +${i + 1}*`} value={`~${k(v)}`} pct={(v / max) * 100} projected sr={`Week +${i + 1} forecast: about ${usd(v)}`} />
          ))}
        </ul>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div className="bg-light-surface-container-low rounded p-3">
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Data sources</p>
            <p className="mt-1">
              <SourceList sources={answer.sources} />
            </p>
          </div>
          <div className="bg-light-surface-container-low rounded p-3">
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Calculation method</p>
            <p className="font-body text-body-sm text-light-on-surface mt-1">{answer.calculation}</p>
          </div>
          <div className="bg-light-surface-container-low rounded p-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Evidence &amp; lineage</p>
              <p className="font-body text-body-sm text-light-on-surface mt-1 tabular-nums">
                {answer.evidence.rows.toLocaleString('en-US')} rows evaluated
              </p>
            </div>
            <TextLink to="/intelligence/evidence/forecast">Inspect →</TextLink>
          </div>
        </div>
      </section>

      <FollowUps
        title="Suggested follow-ups"
        items={[
          { label: 'Which SKUs will stock out under this forecast?', to: askPath(stock.question) },
          { label: "Why is this week's revenue below trend?", to: askPath(decline.question) },
          { label: growth.question, to: askPath(growth.question) },
        ]}
      />
    </div>
  )
}

function Pill({ className, icon, children }: { className: string; icon: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-label text-label-sm', className)}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  )
}

function MetricCard({
  label,
  tag,
  tagClass = 'bg-info-container text-on-info-container',
  value,
  valueClass = 'text-light-on-surface',
  highlight = false,
  children,
}: {
  label: string
  tag: string
  tagClass?: string
  value: string
  valueClass?: string
  highlight?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('bg-light-surface border rounded-md p-4', highlight ? 'border-light-primary' : 'border-light-outline-variant')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-label-md text-light-on-surface-variant">{label}</span>
        <span className={cn('px-2 py-0.5 rounded font-label text-label-sm shrink-0', tagClass)}>{tag}</span>
      </div>
      <p className={cn('font-headline text-headline-md mt-2 tabular-nums', valueClass)} aria-live={highlight ? 'polite' : undefined}>
        {value}
      </p>
      <p className="font-body text-body-sm text-light-on-surface-variant mt-1">{children}</p>
    </div>
  )
}

function Column({
  label,
  value,
  pct,
  projected = false,
  current = false,
  sr,
}: {
  label: string
  value: string
  pct: number
  projected?: boolean
  current?: boolean
  sr: string
}) {
  return (
    <li className="relative flex-1 min-w-[40px] flex flex-col items-center gap-1.5 h-full pb-1">
      {/* Plot area: the bar height is a share of this box, the value floats just above the bar. */}
      <div className="relative flex-1 w-full flex items-end justify-center">
        <div
          aria-hidden="true"
          className={cn(
            'w-full max-w-[44px] rounded-t',
            projected ? 'bg-info-container border-2 border-dashed border-light-primary' : 'bg-light-primary',
          )}
          style={{ height: `${pct}%` }}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 text-center font-mono text-mono-sm whitespace-nowrap',
            projected ? 'text-on-info-container' : 'text-light-on-surface-variant',
          )}
          style={{ bottom: `calc(${pct}% + 6px)` }}
        >
          {value}
        </span>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          'font-label text-label-sm whitespace-nowrap',
          projected ? 'text-on-info-container' : current ? 'text-light-on-surface' : 'text-light-on-surface-variant',
        )}
      >
        {label}
      </span>
      <span className="sr-only">{sr}</span>
    </li>
  )
}
