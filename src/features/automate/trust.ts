import { staleAge, useInsightsTrust } from '../insights/trustLink'
import { useTrustState } from '../trust/store'
import { datasetById, type DatasetId } from './data'

export type TrustStatus = {
  healthy: boolean
  /** "Healthy", "INC-204 open", "3h stale". */
  label: string
  /** Sentence used in banners and gate explanations. */
  detail: string
  /** Trust page that explains the problem. */
  to?: string
}

/**
 * Live Trust status of a workflow's source dataset. public.invoices is unhealthy
 * while INC-204 is open; warehouse.stock_levels while its feed is stale (INC-203).
 * Resolving the incident or refreshing the feed in Trust makes it healthy again.
 */
export function useDatasetTrust(dataset: DatasetId | ''): TrustStatus {
  const t = useInsightsTrust()
  const { incidents } = useTrustState()
  const trust = datasetById(dataset)?.trust ?? 'none'

  if (trust === 'invoices' && t.invoicesUnderReview) {
    return {
      healthy: false,
      label: `${t.invoiceIncidentId} open`,
      detail: `${t.invoiceIncidentId} (duplicate invoice numbers) is open on public.invoices.`,
      to: `/trust/incidents/${t.invoiceIncidentId}`,
    }
  }
  if (trust === 'stock' && t.stockStale) {
    const incident = incidents.find((i) => i.dataset === 'warehouse.stock_levels' && i.status !== 'resolved')
    const age = staleAge(t.stockLastUpdated)
    return {
      healthy: false,
      label: `${age} stale`,
      detail: `warehouse.stock_levels is ${age} stale${incident ? ` (${incident.id})` : ''}.`,
      to: '/trust/freshness',
    }
  }
  return { healthy: true, label: 'Healthy', detail: 'Source data is fresh and has no open Trust incidents.' }
}
