import { useTrustState } from '../trust/store'
import { TRUST_LINKS } from './data'

/**
 * Trust state that Insights figures depend on. Receivables use public.invoices
 * (INC-204, duplicate invoices) and inventory uses warehouse.stock_levels (stale feed).
 * Resolving the incident or refreshing the feed in Trust clears the warnings here.
 */
export function useInsightsTrust() {
  const { incidents, freshness } = useTrustState()
  const invoiceIncident = incidents.find((i) => i.id === TRUST_LINKS.invoicesIncident)
  const stock = freshness.find((f) => f.dataset === TRUST_LINKS.stockDataset)
  return {
    invoicesUnderReview: !!invoiceIncident && invoiceIncident.status !== 'resolved',
    invoiceIncidentId: TRUST_LINKS.invoicesIncident,
    stockStale: !!stock && stock.status !== 'on-time',
    /** "3h 18m ago" while stale; after a refresh, the time it was refreshed. */
    stockLastUpdated: stock?.lastUpdated ?? '',
  }
}

/** "3h 18m ago" → "3h"; used for the compact "3h stale" chips in the designs. */
export function staleAge(lastUpdated: string): string {
  return lastUpdated.match(/^(\d+h)/)?.[1] ?? lastUpdated
}
