import { Link } from 'react-router-dom'
import { StatusBadge } from '../../connect/components/StatusBadge'
import type { TrustDependency } from '../reports'
import { staleAge, useInsightsTrust } from '../trustLink'

/**
 * Trust status chip for a figure or report. Shows the live state of the Trust
 * issue it depends on, so it turns "Verified" once the issue is fixed in Trust.
 */
export function TrustChip({ dependsOn, link = false }: { dependsOn: TrustDependency; link?: boolean }) {
  const t = useInsightsTrust()
  let chip = <StatusBadge tone="success" compact>Verified</StatusBadge>
  let to: string | undefined

  if (dependsOn === 'invoices' && t.invoicesUnderReview) {
    chip = <StatusBadge tone="warning" compact>Trust: {t.invoiceIncidentId}</StatusBadge>
    to = `/trust/incidents/${t.invoiceIncidentId}`
  } else if (dependsOn === 'stock' && t.stockStale) {
    chip = <StatusBadge tone="warning" compact>{staleAge(t.stockLastUpdated)} stale</StatusBadge>
    to = '/trust/freshness'
  }

  if (!link || !to) return chip
  return (
    <Link to={to} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary">
      {chip}
    </Link>
  )
}
