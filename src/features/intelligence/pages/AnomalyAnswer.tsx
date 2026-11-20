import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { usd } from '../../insights/format'
import { useInsightsTrust } from '../../insights/trustLink'
import {
  Code,
  Eyebrow,
  FollowUps,
  MeterRow,
  OutlineLink,
  QuestionHeader,
  ReliabilityPill,
  SourceList,
  StatTile,
  TrustNotice,
} from '../components/AnswerParts'
import { askPath, decline, declineThisWeek, declineTotal, findAnswer, type Answer } from '../data'
import { useFreshness, useReliability } from '../trust'

/** Stock feed incident in Trust (warehouse.stock_levels). */
const STOCK_INCIDENT = 'INC-203'

/** Anomaly explanation (designed: intelligence_anomaly_explanation). */
export function AnomalyAnswer({ answer }: { answer: Answer }) {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Anomaly explanation' }])
  const reliability = useReliability(answer)
  const trust = useInsightsTrust()
  const ordersFresh = useFreshness('public.orders')
  const qualified = reliability.status === 'qualified'
  const dropPct = (declineTotal / decline.baseline) * 100
  const explained = decline.drivers[0].amount + decline.drivers[1].amount
  const ask = (id: string) => {
    const a = findAnswer(id)!
    return { label: a.question, to: askPath(a.question) }
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <QuestionHeader
        question={answer.question}
        aside={
          <ReliabilityPill reliability={reliability}>
            {qualified ? 'Qualified answer (1 stale source)' : 'Verified answer'}
          </ReliabilityPill>
        }
      />

      {qualified && (
        <TrustNotice
          title={`Warehouse feed is ${trust.stockLastUpdated.replace(/ ago$/, '')} stale (Trust incident ${STOCK_INCIDENT})`}
          action={{ label: `View ${STOCK_INCIDENT}`, to: `/trust/incidents/${STOCK_INCIDENT}` }}
        >
          Invoice and order totals are current (<Code>public.orders</Code> updated {ordersFresh}), but Midwest dispatch status
          comes from the warehouse export, which stopped after the 09:00 UTC run. Orders dispatched since then still count as
          held.
        </TrustNotice>
      )}

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-5">
        <div>
          <Eyebrow primary>Direct answer</Eyebrow>
          <p className="font-body text-body-lg text-light-on-surface mt-1 leading-relaxed text-pretty">
            Invoiced wholesale revenue declined{' '}
            <strong className="tabular-nums">
              {dropPct.toFixed(1)}% (-{usd(declineTotal)})
            </strong>{' '}
            this week ({usd(declineThisWeek)} vs. {usd(decline.baseline)} trailing 4-week Mon–Fri average). Two verified factors
            account for {Math.round((explained / declineTotal) * 100)}% of the variance:{' '}
            <strong>delayed Midwest warehouse dispatches (-{usd(decline.drivers[0].amount)})</strong> and{' '}
            <strong>two top wholesale accounts shifting their bi-weekly restock to Monday (-{usd(decline.drivers[1].amount)})</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile
            label="This week (Mon–Fri)"
            value={usd(declineThisWeek)}
            caption={
              <span className="inline-flex items-center gap-1 font-label text-label-sm text-error">
                <Icon name="south_east" size={14} /> -{dropPct.toFixed(1)}% vs 4-wk avg
              </span>
            }
          />
          <StatTile
            label="Unshipped Midwest orders"
            value={usd(decline.drivers[0].amount)}
            caption={`${decline.heldOrders} orders awaiting dispatch`}
          />
          <StatTile label="Timing shift (2 accounts)" value={usd(decline.drivers[1].amount)} caption={decline.shiftedAccounts} />
        </div>

        <div className="flex flex-col gap-3 pt-2 border-t border-light-outline-variant">
          <h2 className="font-title text-title-md text-light-on-surface pt-2">Contributing drivers to -{usd(declineTotal)} variance</h2>
          <div className="flex flex-col gap-2.5">
            {decline.drivers.map((d) => {
              const share = (d.amount / declineTotal) * 100
              return <MeterRow key={d.label} label={d.label} value={`-${usd(d.amount)} (${share.toFixed(1)}%)`} pct={share} tone={d.tone} />
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-light-outline-variant">
          <div>
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Date range &amp; sources</p>
            <p className="font-body text-body-sm text-light-on-surface mt-1">{decline.range}</p>
            <p className="mt-0.5">
              <SourceList sources={answer.sources} />
            </p>
          </div>
          <div>
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Calculation explanation</p>
            <p className="font-body text-body-sm text-light-on-surface mt-1">
              Compared recognized invoice totals (<Code>status = 'invoiced'</Code>) for Mon–Fri against the Mon–Fri mean of
              the prior 4 weeks.
            </p>
          </div>
          <div className="flex items-center md:justify-end">
            <OutlineLink to={`/intelligence/evidence/${answer.id}`}>Inspect SQL &amp; evidence</OutlineLink>
          </div>
        </div>
      </section>

      <FollowUps
        items={[
          { label: 'Check the warehouse feed in Trust', to: '/trust/freshness' },
          ask('sales-comparison'),
          { label: 'Open the wholesale forecast', to: '/intelligence/forecast' },
        ]}
      />
    </div>
  )
}
