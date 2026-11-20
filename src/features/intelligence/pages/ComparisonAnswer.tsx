import type { ReactNode } from 'react'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { headline } from '../../insights/data'
import { growthPct, pct, signedPct, usd } from '../../insights/format'
import { Code, Eyebrow, FollowUps, MeterRow, TextLink, type FollowUp } from '../components/AnswerParts'
import { askPath,
  findAnswer,
  growthByCustomer,
  growthOther,
  topProducts,
  weeklyComparison,
  type Answer,
} from '../data'
import { useFreshness, useReliability } from '../trust'

const followUp = (id: string): FollowUp => {
  const a = findAnswer(id)!
  return { label: a.question, to: askPath(a.question) }
}

/** Answer with a chart (designed: intelligence_query_result_with_charts, for the sales comparison). */
export function ComparisonAnswer({ answer }: { answer: Answer }) {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Query result' }])
  const reliability = useReliability(answer)
  const freshness = useFreshness(answer.sources[0])
  const body = bodies[answer.id]

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-5">
        <div>
          <Eyebrow>Question</Eyebrow>
          <h1 className="font-headline text-headline-md text-light-on-surface mt-0.5">{answer.question}</h1>
        </div>

        {body?.summary}

        <div className="p-5 rounded bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-3">
          {body?.chart}
        </div>

        <p className="font-body text-body-sm text-light-on-surface-variant">
          <strong>Calculation:</strong> {answer.calculation}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-light-outline-variant font-body text-body-sm text-light-on-surface-variant">
          <span>
            Source:{' '}
            {answer.sources.map((s, i) => (
              <span key={s}>
                {i > 0 && ', '}
                <Code>{s}</Code>
              </span>
            ))}{' '}
            · Freshness: {freshness} · Status:{' '}
            <span className={reliability.status === 'verified' ? 'text-success font-label' : 'text-warning font-label'}>
              {reliability.label}
            </span>
          </span>
          <TextLink to={`/intelligence/evidence/${answer.id}`}>View evidence →</TextLink>
        </div>
      </div>

      {body && <FollowUps items={body.followUps} />}
    </div>
  )
}

/* ------------------------------------------------------------------ bodies */

function Summary({ children }: { children: ReactNode }) {
  return <p className="font-body text-body-lg text-light-on-surface text-pretty">{children}</p>
}

function ChartHeader({ title, legend }: { title: string; legend?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-title text-title-md text-light-on-surface">{title}</span>
      {legend}
    </div>
  )
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${className}`} aria-hidden="true" /> {label}
    </span>
  )
}

const salesGrowth = headline.revenue - headline.priorRevenue

function WeeklyComparisonChart() {
  const max = Math.max(...weeklyComparison.flatMap((w) => [w.current, w.prior])) * 1.08
  return (
    <>
      <ChartHeader
        title="Period comparison by week"
        legend={
          <div className="flex items-center gap-4 font-label text-label-sm text-light-on-surface">
            <Swatch className="bg-light-primary" label="This month" />
            <Swatch className="bg-light-outline" label="Last month" />
          </div>
        }
      />
      <figure className="flex flex-col gap-2">
        <ul className="h-40 flex items-end gap-6 pt-3" aria-label="Weekly revenue, this month vs last month">
          {weeklyComparison.map((w) => (
            <li key={w.label} className="flex-1 flex items-end gap-1.5 h-full">
              <div
                className="flex-1 bg-light-outline rounded-sm"
                style={{ height: `${(w.prior / max) * 100}%` }}
                title={`${w.label} last month: ${usd(w.prior)}`}
              />
              <div
                className="flex-1 bg-light-primary rounded-sm"
                style={{ height: `${(w.current / max) * 100}%` }}
                title={`${w.label} this month: ${usd(w.current)}`}
              />
              <span className="sr-only">
                {w.label}: this month {usd(w.current)}, last month {usd(w.prior)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-6" aria-hidden="true">
          {weeklyComparison.map((w) => (
            <span key={w.label} className="flex-1 text-center font-label text-label-sm text-light-on-surface-variant">
              {w.label}
              <span className="block font-mono text-mono-sm tabular-nums">{signedPct(growthPct(w.current, w.prior))}</span>
            </span>
          ))}
        </div>
      </figure>
    </>
  )
}

const productTotal = topProducts.reduce((s, p) => s + p.revenue, 0)

function TopProductsChart() {
  const max = topProducts[0].revenue
  return (
    <>
      <ChartHeader title="Revenue by SKU, last 30 days" />
      <div className="flex flex-col gap-3">
        {topProducts.map((p) => (
          <MeterRow
            key={p.sku}
            label={
              <>
                <span className="font-mono text-mono-sm text-light-on-surface-variant mr-2">{p.sku}</span>
                {p.name}
              </>
            }
            value={`${usd(p.revenue)} · ${p.unitsSold.toLocaleString('en-US')} units · ${pct(p.marginPct)} margin`}
            pct={(p.revenue / max) * 100}
          />
        ))}
      </div>
    </>
  )
}

const top5Growth = growthByCustomer.reduce((s, c) => s + c.growth, 0)

function GrowthChart() {
  const max = Math.max(growthByCustomer[0].growth, growthOther)
  return (
    <>
      <ChartHeader title={`Contribution to ${usd(salesGrowth)} revenue growth`} />
      <div className="flex flex-col gap-3">
        {growthByCustomer.map((c) => (
          <MeterRow
            key={c.name}
            label={c.name}
            value={`+${usd(c.growth)} (${pct((c.growth / salesGrowth) * 100)})`}
            pct={(c.growth / max) * 100}
          />
        ))}
        <MeterRow
          label="All other accounts (313)"
          value={`+${usd(growthOther)} (${pct((growthOther / salesGrowth) * 100)})`}
          pct={(growthOther / max) * 100}
          tone="neutral"
        />
      </div>
    </>
  )
}

const bodies: Record<string, { summary: ReactNode; chart: ReactNode; followUps: FollowUp[] }> = {
  'sales-comparison': {
    summary: (
      <Summary>
        Revenue in the last 30 days reached <strong className="tabular-nums">{usd(headline.revenue)}</strong>, up{' '}
        <strong className="text-success tabular-nums">
          {signedPct(growthPct(headline.revenue, headline.priorRevenue))} (+{usd(salesGrowth)})
        </strong>{' '}
        compared to the prior 30-day period (<span className="tabular-nums">{usd(headline.priorRevenue)}</span>).
      </Summary>
    ),
    chart: <WeeklyComparisonChart />,
    followUps: [followUp('growth-customers'), followUp('top-products'), { label: 'Open sales analytics', to: '/insights/sales' }],
  },
  'top-products': {
    summary: (
      <Summary>
        <strong>{topProducts[0].name}</strong> (<Code>{topProducts[0].sku}</Code>) was the top seller with{' '}
        <strong className="tabular-nums">{usd(topProducts[0].revenue)}</strong> in the last 30 days. The top 5 SKUs brought in{' '}
        <strong className="tabular-nums">{usd(productTotal)}</strong>, {pct((productTotal / headline.revenue) * 100)} of total
        revenue.
      </Summary>
    ),
    chart: <TopProductsChart />,
    followUps: [followUp('stockout-risk'), followUp('sales-comparison'), { label: 'Open product analytics', to: '/insights/products' }],
  },
  'growth-customers': {
    summary: (
      <Summary>
        Five accounts drove <strong className="tabular-nums">+{usd(top5Growth)}</strong> (
        {pct((top5Growth / salesGrowth) * 100)}) of the <strong className="tabular-nums">+{usd(salesGrowth)}</strong> increase
        over the prior 30 days. <strong>{growthByCustomer[0].name}</strong> contributed the most, at{' '}
        <strong className="text-success tabular-nums">+{usd(growthByCustomer[0].growth)}</strong>.
      </Summary>
    ),
    chart: <GrowthChart />,
    followUps: [followUp('sales-comparison'), followUp('overdue-customers'), { label: 'Open customer analytics', to: '/insights/customers' }],
  },
}
