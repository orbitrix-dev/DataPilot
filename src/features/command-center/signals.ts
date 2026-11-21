import { useAutomateState } from '../automate/store'
import { invoiceRows } from '../automate/data'
import { useConnectState } from '../connect/store'
import { formatShortUtc } from '../connect/format'
import { headline, inventoryStats, stock } from '../insights/data'
import { growthPct, pct, usd } from '../insights/format'
import { reports, type TrustDependency } from '../insights/reports'
import { staleAge, useInsightsTrust } from '../insights/trustLink'
import { decline, declineThisWeek, declineTotal, overdue, stockRisks } from '../intelligence/data'
import { useIntelligenceState } from '../intelligence/store'
import { overviewStatic } from '../trust/data'
import { isOpen } from '../trust/status'
import { useTrustState } from '../trust/store'

/**
 * Command Center figures. Nothing here is new data: every number comes from
 * the Insights, Intelligence, Trust, Connect and Automate modules, so the
 * Command Center agrees with the pages it links to and follows their session
 * state (resolving an incident, approving a request, creating a PO draft).
 */

/* ----------------------------------------------------------- static figures */

const below = stockRisks.filter((r) => r.daysOfCover < r.leadDays)
const slowest = [...stock].sort((a, b) => b.daysOfCover - a.daysOfCover)[0]
const held = decline.drivers[0]
const shifted = decline.drivers[1]

export const figures = {
  revenue: headline.revenue,
  revenueGrowthPct: growthPct(headline.revenue, headline.priorRevenue),
  revenueDelta: headline.revenue - headline.priorRevenue,
  orders: headline.orders,
  orderGrowthPct: growthPct(headline.orders, headline.priorOrders),
  /** This week's Mon–Fri invoiced revenue against the prior 4-week Mon–Fri average. */
  week: { revenue: declineThisWeek, baseline: decline.baseline, drop: declineTotal, dropPct: (declineTotal / decline.baseline) * 100 },
  held: { orders: decline.heldOrders, amount: held.amount },
  shifted: { accounts: decline.shiftedAccounts, amount: shifted.amount },
  grossMarginPct: headline.grossMarginPct,
  outstanding: headline.outstanding,
  /** 61–90 and 90+ aging buckets, as in the Intelligence overdue answer. */
  overdue60: overdue.total,
  overdueSharePct: (overdue.total / headline.outstanding) * 100,
  largestOverdue: overdue.largest,
  largestOverdueDays: overdue.rows.find((r) => r.customer === overdue.largest.customer)?.oldestDays ?? 0,
  inventoryValue: headline.inventoryValue,
  belowLead: below,
  slowMoving: inventoryStats.slowMoving,
  slowest,
}

export const belowLeadSkus = below.map((r) => r.sku).join(' and ')
export const belowLeadDetail = below.map((r) => `${r.sku} (${r.daysOfCover}d cover vs ${r.leadDays}d lead time)`).join(' and ')

/* ------------------------------------------------------------- live status */

export type Tone = 'success' | 'warning' | 'error' | 'neutral'

export type Alert = {
  id: string
  kind: 'business' | 'technical'
  category: string
  title: string
  detail: string
  /** Where the figure comes from, or when the issue started. */
  meta: string
  tone: 'error' | 'warning'
  to: string
  linkLabel: string
  /** Business alerts carry the Trust status of their source data. */
  dependsOn?: TrustDependency
}

export type ActionItem = {
  id: string
  area: 'Receivables' | 'Inventory' | 'Sales' | 'Data reliability'
  title: string
  detail: string
  /** Extra warning shown while the source data has a Trust issue. */
  caution?: { text: string; to: string }
  to: string
  cta: string
  /** Set once the action has been taken elsewhere in the app. */
  done?: { text: string; to?: string; linkLabel?: string }
  /** Sub-tasks with their own links (open incidents, failing sources). */
  steps?: { text: string; to: string; linkLabel: string }[]
}

/** One hook for every Command Center page. */
export function useCommandCenter() {
  const t = useInsightsTrust()
  const { incidents, freshness } = useTrustState()
  const { connections } = useConnectState()
  const { requests, runs } = useAutomateState()
  const { poDrafts } = useIntelligenceState()

  const openIncidents = incidents.filter(isOpen)
  const failingSources = connections.filter((c) => c.status === 'failed')
  const failedRuns = runs.filter((r) => r.outcome === 'failed')
  const lateFeeds = freshness.filter((f) => f.status !== 'on-time')
  const qualifies = (dep: TrustDependency) => (dep === 'invoices' && t.invoicesUnderReview) || (dep === 'stock' && t.stockStale)
  const qualifiedReports = reports.filter((r) => qualifies(r.dependsOn))
  const critical = openIncidents.some((i) => i.severity === 'critical') || failingSources.length > 0

  const reliability = {
    score: overviewStatic.reliability,
    tone: (critical ? 'error' : openIncidents.length || lateFeeds.length || failedRuns.length ? 'warning' : 'success') as Tone,
    label: openIncidents.length || lateFeeds.length || failingSources.length ? 'Attention needed' : 'All checks healthy',
    feeds: freshness.map((f) => ({
      dataset: f.dataset,
      status: f.status,
      ago: f.lastUpdated.replace(/\s*\(.*\)$/, ''),
      incident: incidents.find((i) => i.dataset === f.dataset && isOpen(i))?.id,
    })),
    orders: freshness.find((f) => f.dataset === 'public.orders'),
    stock: freshness.find((f) => f.dataset === 'warehouse.stock_levels'),
  }

  /* -------------------------------------------------------------- alerts */

  const business: Alert[] = [
    {
      id: 'revenue-decline',
      kind: 'business',
      category: 'Revenue decline',
      title: `This week’s invoiced revenue is down ${figures.week.dropPct.toFixed(1)}% (-${usd(figures.week.drop)})`,
      detail: `${figures.held.orders} Midwest orders held awaiting dispatch and a restock-cycle shift at ${figures.shifted.accounts}.`,
      meta: 'Mon–Fri vs prior 4-week average · public.invoices',
      tone: 'error',
      to: '/intelligence/answers/revenue-decline',
      linkLabel: 'Investigate in Intelligence',
      dependsOn: 'stock',
    },
    {
      id: 'overdue-payments',
      kind: 'business',
      category: 'Overdue payments',
      title: `${usd(figures.overdue60)} in receivables is more than 60 days past due`,
      detail: `${figures.largestOverdue.customer} owes ${usd(figures.largestOverdue.amount)}; its oldest invoice is ${figures.largestOverdueDays} days old.`,
      meta: `${pct(figures.overdueSharePct)} of ${usd(figures.outstanding)} outstanding · public.invoices`,
      tone: 'warning',
      to: '/insights/receivables',
      linkLabel: 'Open Receivables',
      dependsOn: 'invoices',
    },
    {
      id: 'low-stock',
      kind: 'business',
      category: 'Low stock',
      title: `${figures.belowLead.length} SKUs have less cover than their supplier lead time`,
      detail: `${belowLeadDetail}.`,
      meta: 'warehouse.stock_levels',
      tone: 'warning',
      to: '/intelligence/answers/stockout-risk',
      linkLabel: 'Review reorder recommendation',
      dependsOn: 'stock',
    },
  ]

  const technical: Alert[] = [
    ...openIncidents.map<Alert>((i) => ({
      id: i.id,
      kind: 'technical',
      category: i.severity === 'critical' ? 'Data quality incident' : 'Data freshness incident',
      title: `${i.id}: ${i.title}`,
      detail: i.summary,
      meta: `${i.dataset} · detected ${formatShortUtc(i.firstDetected)}`,
      tone: i.severity === 'critical' ? 'error' : 'warning',
      to: `/trust/incidents/${i.id}`,
      linkLabel: 'Inspect in Trust',
    })),
    ...failingSources.map<Alert>((c) => ({
      id: c.id,
      kind: 'technical',
      category: 'Sync failure',
      title: `${c.name} is not syncing`,
      detail: c.issue ?? 'The last sync failed.',
      meta: `Last successful sync ${formatShortUtc(c.lastSync)}`,
      tone: 'error',
      to: `/connect/connections/${c.id}`,
      linkLabel: 'Open in Connect',
    })),
    ...failedRuns.map<Alert>((r) => ({
      id: r.id,
      kind: 'technical',
      category: 'Automation delivery',
      title: `${r.id} failed: ${r.summary}`,
      detail:
        r.retriesUsed != null
          ? `All ${r.retriesUsed} automatic retries failed. Nothing was sent; it is waiting for a manual retry.`
          : 'Nothing was sent; it is waiting for a manual retry.',
      meta: `Approved by ${r.approvedBy} · ${r.time}`,
      tone: 'warning',
      to: `/automate/runs/${r.id}`,
      linkLabel: 'Open execution log',
    })),
  ]

  /* ------------------------------------------------------------- actions */

  const followUp = requests.find((r) => r.id === 'REQ-9040')
  const followUpRows = (followUp?.matched ?? []).map((id) => invoiceRows.find((r) => r.id === id)).filter(Boolean)
  const followUpText = followUpRows.map((r) => `${r!.customer} (${usd(Number(r!.balance_due))}, ${r!.days_overdue} days)`).join(' and ')

  const reorderSkus = below.map((r) => r.sku)
  const drafted = reorderSkus.every((s) => poDrafts.includes(s))

  const actions: ActionItem[] = [
    {
      id: 'overdue-follow-up',
      area: 'Receivables',
      title: 'Follow up on overdue payments',
      detail: `${followUpText} are past due. Approval request ${followUp?.id} will email the account owner once approved.`,
      caution: t.invoicesUnderReview
        ? { text: `${t.invoiceIncidentId} (duplicate invoice numbers) is open on public.invoices. Check the amounts before approving.`, to: `/trust/incidents/${t.invoiceIncidentId}` }
        : undefined,
      to: '/automate/approvals',
      cta: 'Review in Approval Center',
      done:
        followUp?.status === 'approved'
          ? { text: `Approved by ${followUp.decidedBy}.`, to: followUp.runId ? `/automate/runs/${followUp.runId}` : undefined, linkLabel: followUp.runId ? `Open ${followUp.runId}` : undefined }
          : followUp?.status === 'rejected'
            ? { text: `Rejected by ${followUp.decidedBy}${followUp.reason ? `: “${followUp.reason}”` : '.'}`, to: '/automate/history', linkLabel: 'Execution history' }
            : undefined,
    },
    {
      id: 'reorder',
      area: 'Inventory',
      title: `Reorder ${belowLeadSkus}`,
      detail: `${below.map((r) => `${r.name} has ${r.daysOfCover} days of cover against a ${r.leadDays}-day lead time`).join('; ')}. Suggested orders: ${below.map((r) => `${r.suggested} ${r.unit}`).join(' and ')}.`,
      caution: t.stockStale
        ? { text: `Stock counts are ${staleAge(t.stockLastUpdated)} old (warehouse.stock_levels). Confirm on-hand quantities before ordering.`, to: '/trust/freshness' }
        : undefined,
      to: '/intelligence/answers/stockout-risk',
      cta: 'Review recommendation',
      done: drafted
        ? { text: 'PO draft created and waiting for approval. Nothing has been sent to suppliers.', to: '/intelligence/answers/stockout-risk', linkLabel: 'View draft' }
        : undefined,
    },
    {
      id: 'sales-decline',
      area: 'Sales',
      title: 'Investigate the weekly sales decline',
      detail: `${figures.held.orders} Midwest orders (${usd(figures.held.amount)}) are held awaiting dispatch, and the ${figures.shifted.accounts} restock cycle moved ${usd(figures.shifted.amount)} into next week. Confirm the carrier pickup schedule with the regional warehouse.`,
      to: '/intelligence/answers/revenue-decline',
      cta: 'View Intelligence breakdown',
    },
    {
      id: 'data-reliability',
      area: 'Data reliability',
      title: 'Resolve data reliability issues',
      detail: 'These issues qualify figures across Insights, Intelligence and Automate until they are fixed.',
      steps: [
        ...openIncidents.map((i) => ({ text: `${i.id}: ${i.shortTitle} (${i.dataset})`, to: `/trust/incidents/${i.id}`, linkLabel: 'Open in Trust' })),
        ...failingSources.map((c) => ({ text: `${c.name}: ${c.issue ?? 'sync failing'}`, to: `/connect/connections/${c.id}`, linkLabel: 'Open in Connect' })),
      ],
      to: '/trust/incidents',
      cta: 'Open Trust incidents',
      done: openIncidents.length || failingSources.length ? undefined : { text: 'No open incidents or failing sources.', to: '/trust', linkLabel: 'Trust overview' },
    },
    {
      id: 'slow-moving',
      area: 'Inventory',
      title: 'Review slow-moving inventory',
      detail: `${figures.slowMoving} SKUs are slow-moving. ${figures.slowest.name} (${figures.slowest.sku}) has ${figures.slowest.daysOfCover} days of cover with ${figures.slowest.onHand} on hand. Consider bundling or transferring stock.`,
      to: '/insights/inventory',
      cta: 'Open Inventory analytics',
    },
  ]

  const openActions = actions.filter((a) => !a.done)

  return {
    trust: t,
    qualifies,
    reliability,
    openIncidents,
    failingSources,
    failedRuns,
    qualifiedReports,
    alerts: { business, technical, count: business.length + technical.length },
    actions: [...openActions, ...actions.filter((a) => a.done)],
    openActions,
  }
}

export type CommandCenter = ReturnType<typeof useCommandCenter>
