import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { useInsightsTrust } from '../../insights/trustLink'
import {
  Code,
  Eyebrow,
  FollowUps,
  OutlineLink,
  QuestionHeader,
  ReliabilityPill,
  TrustNotice,
} from '../components/AnswerParts'
import { askPath, findAnswer, SAFETY_DAYS, stockRisks, type Answer, type RiskLevel, type StockRisk } from '../data'
import { createPoDraft, discardPoDraft, useIntelligenceState } from '../store'
import { useFreshness, useReliability } from '../trust'

const levelMeta: Record<RiskLevel, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'bg-error-container text-on-error-container' },
  'at-risk': { label: 'At risk', className: 'bg-warning-container text-on-warning-container' },
  watch: { label: 'Watch', className: 'bg-light-surface-container text-light-on-surface-variant' },
}

const qty = (r: Pick<StockRisk, 'unit'>, n: number) => `${n.toLocaleString('en-US')} ${r.unit}`

/** Stock-out recommendation (designed: intelligence_recommendation_details). */
export function RecommendationAnswer({ answer }: { answer: Answer }) {
  usePageChrome([{ label: 'Intelligence', to: '/intelligence' }, { label: 'Recommendation' }])
  const reliability = useReliability(answer)
  const trust = useInsightsTrust()
  const ordersFresh = useFreshness('public.orders')
  const toast = useToast()
  const { poDrafts } = useIntelligenceState()
  const qualified = reliability.status === 'qualified'

  const flagged = stockRisks.filter((r) => r.suggested > 0)
  const leadTimes = flagged.map((r) => r.leadDays)
  const draftOpen = flagged.length > 0 && flagged.every((r) => poDrafts.includes(r.sku))
  const draftSummary = flagged.map((r) => `${r.sku} (${qty(r, r.suggested)})`).join(' and ')
  const forecast = findAnswer('forecast')!
  const top = findAnswer('top-products')!

  function createDraft() {
    createPoDraft(flagged.map((r) => r.sku))
    toast('Purchase order draft created — pending approval')
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <QuestionHeader
        question={answer.question}
        aside={
          <ReliabilityPill reliability={reliability}>{qualified ? 'Qualified recommendation' : 'Verified recommendation'}</ReliabilityPill>
        }
      />

      {qualified && (
        <TrustNotice
          icon="schedule"
          title={`Warehouse inventory feed is ${trust.stockLastUpdated.replace(/ ago$/, '')} stale`}
          action={{ label: 'Verify in Trust', to: '/trust/freshness' }}
        >
          On-hand quantities come from <Code>warehouse.stock_levels</Code>, last updated {trust.stockLastUpdated}. Check physical
          stock or recent receiving logs before submitting purchase orders.
        </TrustNotice>
      )}

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <Eyebrow primary>Recommended action</Eyebrow>
            <h2 className="font-headline text-headline-md text-light-on-surface mt-1">
              Prioritize reorder for {flagged.length} high-velocity SKUs
            </h2>
            <p className="font-body text-body-md text-light-on-surface-variant mt-1 text-pretty">
              Based on 30-day average daily demand and supplier lead times ({Math.min(...leadTimes)}–{Math.max(...leadTimes)}{' '}
              days),{' '}
              {flagged.map((r, i) => (
                <span key={r.sku}>
                  {i > 0 && ' and '}
                  <Code>{r.sku}</Code>
                </span>
              ))}{' '}
              will run out before a new order can arrive.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={createDraft} disabled={draftOpen}>
              {draftOpen ? 'PO draft created' : 'Create PO draft'}
            </Button>
            <OutlineLink to={`/intelligence/evidence/${answer.id}`}>View evidence</OutlineLink>
          </div>
        </div>

        {draftOpen && (
          <div role="status" className="bg-success-container rounded p-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-body text-body-sm text-on-success-container">
              Purchase order draft prepared for {draftSummary} — pending human approval. Nothing has been sent to suppliers.
            </span>
            <button
              type="button"
              onClick={discardPoDraft}
              className="font-label text-label-sm text-on-success-container underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
            >
              Discard draft
            </button>
          </div>
        )}

        <div className="overflow-x-auto border border-light-outline-variant rounded-md">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">SKUs under the 14-day reorder threshold</caption>
            <thead>
              <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
                {['SKU & product', qualified ? `On hand (${trust.stockLastUpdated})` : 'On hand', '30d avg / day', 'Days of cover', 'Suggested order'].map(
                  (h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-label text-label-sm uppercase text-light-on-surface-variant whitespace-nowrap">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant">
              {stockRisks.map((r) => (
                <tr key={r.sku}>
                  <td className="px-4 py-3">
                    <p className="font-label text-label-md text-light-on-surface">{r.name}</p>
                    <p className="font-mono text-mono-sm text-light-on-surface-variant">
                      {r.sku} · Lead time {r.leadDays}d · {r.supplier}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-mono-sm text-light-on-surface whitespace-nowrap">{qty(r, r.onHand)}</td>
                  <td className="px-4 py-3 font-mono text-mono-sm text-light-on-surface whitespace-nowrap">{r.avgDaily.toFixed(1)} / day</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded font-label text-label-sm whitespace-nowrap', levelMeta[r.level].className)}>
                      {r.daysOfCover.toFixed(1)} days ({levelMeta[r.level].label})
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 font-label text-label-md whitespace-nowrap',
                      r.suggested ? 'text-light-primary' : 'text-light-on-surface-variant',
                    )}
                  >
                    {r.suggested ? qty(r, r.suggested) : 'No action yet'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="bg-light-surface-container-low rounded p-3">
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Calculation formula</p>
            <p className="font-body text-body-sm text-light-on-surface mt-1">
              <Code>Days of cover = On hand / 30d avg daily units</Code>. SKUs with fewer days of cover than the supplier lead
              time are flagged. Suggested order covers the lead time plus {SAFETY_DAYS} days of safety stock, rounded up to 10.
            </p>
          </div>
          <div className="bg-light-surface-container-low rounded p-3">
            <p className="font-label text-label-sm text-light-on-surface-variant uppercase">Authorized sources</p>
            <p className="font-mono text-mono-sm text-light-on-surface mt-1">
              warehouse.stock_levels ({qualified ? `${trust.stockLastUpdated.replace(/ ago$/, '')} stale` : 'fresh'}) · public.orders (
              {ordersFresh})
            </p>
          </div>
        </div>
      </section>

      <FollowUps
        items={[
          { label: 'Open inventory analytics', to: '/insights/inventory' },
          { label: 'Open the weekly reorder report', to: '/insights/reports/weekly-low-stock-reorder' },
          { label: top.question, to: askPath(top.question) },
          { label: 'Will demand rise next month?', to: askPath(forecast.question) },
        ]}
      />
    </div>
  )
}
