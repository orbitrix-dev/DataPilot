import { useInsightsTrust } from '../insights/trustLink'
import { useTrustState } from '../trust/store'
import type { Answer, HistoryStatus } from './data'

export type Reliability = {
  status: Exclude<HistoryStatus, 'unanswered'>
  /** "Verified", "Qualified (INC-204)", "Forecast". */
  label: string
  /** Trust page that explains the qualification. */
  to?: string
  /** Short tag stored in history, e.g. "INC-204" or "Stale feed". */
  qualifiedBy?: string
}

/**
 * Live reliability of an answer. Answers on public.invoices are qualified
 * while INC-204 is open; answers on warehouse.stock_levels while the feed is
 * stale. Fixing either in Trust turns the answer Verified.
 */
export function reliabilityOf(answer: Answer, t: ReturnType<typeof useInsightsTrust>): Reliability {
  if (answer.kind === 'forecast') return { status: 'forecast', label: 'Forecast' }
  if (answer.dependsOn === 'invoices' && t.invoicesUnderReview) {
    return {
      status: 'qualified',
      label: `Qualified (${t.invoiceIncidentId})`,
      to: `/trust/incidents/${t.invoiceIncidentId}`,
      qualifiedBy: t.invoiceIncidentId,
    }
  }
  if (answer.dependsOn === 'stock' && t.stockStale) {
    return { status: 'qualified', label: 'Qualified (stale feed)', to: '/trust/freshness', qualifiedBy: 'Stale feed' }
  }
  return { status: 'verified', label: 'Verified' }
}

export function useReliability(answer: Answer): Reliability {
  return reliabilityOf(answer, useInsightsTrust())
}

/** "4m ago" for the answer's primary dataset, from the Trust freshness monitor. */
export function useFreshness(dataset: string): string {
  const { freshness } = useTrustState()
  const row = freshness.find((f) => f.dataset === dataset)
  return row ? row.lastUpdated.replace(/\s*\(.*\)$/, '') : '4m ago'
}
