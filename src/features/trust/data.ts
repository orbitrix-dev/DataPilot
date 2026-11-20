/**
 * Mock Trust data. Values come from the Stitch Trust screens; where a screen
 * was only designed for one incident (INC-204), the other incidents were
 * written in the same voice so every link resolves.
 */

export type Severity = 'critical' | 'warning'
export type IncidentStatus = 'investigating' | 'acknowledged' | 'resolved'

export type CauseStep = { label: string; title: string; detail: string; tone: 'warning' | 'error' | 'neutral' }

export type Incident = {
  id: string
  title: string
  /** Shorter title for the overview preview table. */
  shortTitle: string
  /** Heading on the details page. */
  headline: string
  severity: Severity
  status: IncidentStatus
  dataset: string
  firstDetected: string
  /** One-line business summary for the overview table. */
  summary: string
  impactLabel: string
  businessCause: string
  resolution: { text: string; code?: string; after?: string }
  evidence: string[]
  history: { time: string; text: string }[]
  rcaSubtitle: string
  causalChain: CauseStep[]
}

export const incidents: Incident[] = [
  {
    id: 'INC-204',
    title: 'Duplicate invoice numbers detected',
    shortTitle: 'Duplicate invoice numbers',
    headline: 'Duplicate invoice numbers in public.invoices',
    severity: 'critical',
    status: 'investigating',
    dataset: 'public.invoices',
    firstDetected: '2026-11-20T09:44:00Z',
    summary: 'May overstate daily revenue in Receivables report',
    impactLabel: '2 dashboards · 1 metric',
    businessCause:
      '14 invoices from the morning ERP batch were imported twice after a temporary network retry. Until deduplicated, total billed revenue in Receivables reports may appear $18,450 higher than actuals.',
    resolution: {
      text: 'Re-run the incremental deduplication sync on ',
      code: 'public.invoices',
      after: ' and verify the Receivables dashboard total.',
    },
    evidence: [
      'SELECT invoice_no, COUNT(*) FROM public.invoices',
      'GROUP BY invoice_no HAVING COUNT(*) > 1;',
      '-- Returned 14 duplicate keys (INV-88410..INV-88423)',
    ],
    history: [
      { time: '09:44 UTC', text: 'DataTrust Duplicate Check failed (14 rows)' },
      { time: '09:45 UTC', text: 'Alert dispatched to Elena Vance' },
      { time: '10:02 UTC', text: 'Status set to Investigating' },
    ],
    rcaSubtitle: 'Tracing how an upstream sync retry produced duplicate invoice records.',
    causalChain: [
      {
        label: '1. Upstream trigger (09:41 UTC)',
        title: 'Sync retry overlapped checkpoint',
        detail: 'PostgreSQL replica reset connection mid-batch.',
        tone: 'warning',
      },
      {
        label: '2. Rule failure (09:44 UTC)',
        title: '14 duplicate invoice_no rows',
        detail: 'Caught immediately by DataTrust uniqueness rule.',
        tone: 'error',
      },
      {
        label: '3. Containment',
        title: 'Downstream warning banner active',
        detail: 'Finance team notified before daily close.',
        tone: 'neutral',
      },
    ],
  },
  {
    id: 'INC-203',
    title: 'Warehouse stock feed delayed 3 hours',
    shortTitle: 'Inventory feed delayed 3h',
    headline: 'Stock feed delayed in warehouse.stock_levels',
    severity: 'warning',
    status: 'acknowledged',
    dataset: 'warehouse.stock_levels',
    firstDetected: '2026-11-20T11:10:00Z',
    summary: 'Stock counts reflect 09:00 UTC snapshot',
    impactLabel: '1 alerting workflow',
    businessCause:
      'The hourly stock export from the warehouse system stopped after the 09:00 UTC run. Reorder alerts are still firing, but they use stock counts that are more than 3 hours old.',
    resolution: {
      text: 'Refresh ',
      code: 'warehouse.stock_levels',
      after: ' from Freshness monitoring, then confirm the next hourly run lands on time.',
    },
    evidence: [
      'SELECT MAX(snapshot_at) FROM warehouse.stock_levels;',
      '-- 2026-11-20 09:00 UTC (expected: hourly)',
      '-- MySQL export job warehouse_stock_hourly: 3 runs skipped',
    ],
    history: [
      { time: '11:10 UTC', text: 'DataTrust Freshness Check missed SLA (1h)' },
      { time: '11:11 UTC', text: 'Alert dispatched to Operations Lead' },
      { time: '11:25 UTC', text: 'Status set to Acknowledged' },
    ],
    rcaSubtitle: 'Tracing why the hourly warehouse export stopped delivering new stock counts.',
    causalChain: [
      {
        label: '1. Upstream trigger (09:58 UTC)',
        title: 'Export job lock not released',
        detail: 'MySQL export job held a table lock after a timeout.',
        tone: 'warning',
      },
      {
        label: '2. Rule failure (11:10 UTC)',
        title: 'Freshness SLA missed by 1h 10m',
        detail: 'Caught by DataTrust freshness check on stock_levels.',
        tone: 'error',
      },
      {
        label: '3. Containment',
        title: 'Reorder alerts flagged as delayed',
        detail: 'Operations Lead notified; manual counts in use.',
        tone: 'neutral',
      },
    ],
  },
  {
    id: 'INC-199',
    title: 'Missing currency code on EU orders',
    shortTitle: 'Missing currency code on EU orders',
    headline: 'Missing currency code on EU orders in public.orders',
    severity: 'warning',
    status: 'resolved',
    dataset: 'public.orders',
    firstDetected: '2026-11-19T16:20:00Z',
    summary: 'EU order totals excluded from currency conversion',
    impactLabel: '1 dashboard',
    businessCause:
      '312 EU orders arrived without a currency code after a storefront release. They were left out of currency conversion, so EU revenue was understated by about €9,800 until the fix was backfilled.',
    resolution: {
      text: 'Backfill ',
      code: 'currency_code',
      after: ' from the storefront locale and re-run the orders null check.',
    },
    evidence: [
      "SELECT COUNT(*) FROM public.orders WHERE region = 'EU'",
      'AND currency_code IS NULL;',
      '-- Returned 312 rows before backfill, 0 after',
    ],
    history: [
      { time: 'Nov 19, 16:20 UTC', text: 'DataTrust Null Check failed (312 rows)' },
      { time: 'Nov 19, 16:48 UTC', text: 'Status set to Investigating' },
      { time: 'Nov 19, 19:05 UTC', text: 'Backfill completed; null check passing' },
      { time: 'Nov 19, 19:10 UTC', text: 'Marked resolved and verified fixed' },
    ],
    rcaSubtitle: 'Tracing how a storefront release dropped currency codes from EU orders.',
    causalChain: [
      {
        label: '1. Upstream trigger (15:55 UTC)',
        title: 'Storefront release changed checkout payload',
        detail: 'currency_code moved to a nested field for EU locales.',
        tone: 'warning',
      },
      {
        label: '2. Rule failure (16:20 UTC)',
        title: '312 orders with null currency_code',
        detail: 'Caught by DataTrust null check on public.orders.',
        tone: 'error',
      },
      {
        label: '3. Containment',
        title: 'Backfilled and verified',
        detail: 'EU revenue restated before the next daily close.',
        tone: 'neutral',
      },
    ],
  },
]

export type RuleType = 'Null check' | 'Duplicate check' | 'Schema validation' | 'Record count check' | 'Reconciliation check'
export type RuleStatus = 'passing' | 'failed' | 'warning' | 'pending'

export type QualityRule = {
  id: string
  type: RuleType
  target: string
  explanation: string
  status: RuleStatus
  statusLabel: string
  lastEvaluated: string
}

export const ruleTypes: RuleType[] = [
  'Null check',
  'Duplicate check',
  'Schema validation',
  'Record count check',
  'Reconciliation check',
]

export const qualityRules: QualityRule[] = [
  {
    id: 'rule-1',
    type: 'Null check',
    target: 'public.orders.customer_id',
    explanation: 'Every order must belong to a valid customer',
    status: 'passing',
    statusLabel: 'Passing (0 nulls)',
    lastEvaluated: '14:28 UTC',
  },
  {
    id: 'rule-2',
    type: 'Duplicate check',
    target: 'public.invoices.invoice_no',
    explanation: 'Prevents double-counting billed revenue',
    status: 'failed',
    statusLabel: 'Failed (14 dupes)',
    lastEvaluated: '14:28 UTC',
  },
  {
    id: 'rule-3',
    type: 'Schema validation',
    target: 'public.orders',
    explanation: 'Detects unexpected or removed columns',
    status: 'warning',
    statusLabel: '1 column added',
    lastEvaluated: '14:15 UTC',
  },
  {
    id: 'rule-4',
    type: 'Record count check',
    target: 'public.shipments',
    explanation: 'Flags sudden drops in daily shipment volume',
    status: 'passing',
    statusLabel: 'Passing (1,840)',
    lastEvaluated: '14:10 UTC',
  },
  {
    id: 'rule-5',
    type: 'Reconciliation check',
    target: 'orders vs invoices',
    explanation: 'Matches shipped order totals to billed invoices',
    status: 'warning',
    statusLabel: '$420.00 variance',
    lastEvaluated: '14:00 UTC',
  },
]

export type FreshnessStatus = 'on-time' | 'stale' | 'breached'

export type FreshnessRow = {
  dataset: string
  sla: string
  lastUpdated: string
  status: FreshnessStatus
  /** Connect connection that feeds the dataset, for breached SLAs. */
  connectionId?: string
}

export const freshness: FreshnessRow[] = [
  { dataset: 'public.orders', sla: 'Every 15 mins', lastUpdated: '4m ago (14:28 UTC)', status: 'on-time' },
  { dataset: 'warehouse.stock_levels', sla: 'Every 1 hour', lastUpdated: '3h 18m ago', status: 'stale' },
  {
    dataset: 's3.raw_orders',
    sla: 'Every 4 hours',
    lastUpdated: '16h 32m ago',
    status: 'breached',
    connectionId: 'amazon-s3-raw-orders',
  },
]

export const passRateByDay = [
  { day: 'Mon', pct: 96 },
  { day: 'Tue', pct: 98 },
  { day: 'Wed', pct: 95 },
  { day: 'Thu', pct: 88 },
  { day: 'Fri', pct: 97 },
  { day: 'Sat', pct: 99 },
  { day: 'Sun', pct: 97 },
]

export type DomainHealth = {
  name: string
  passing: number
  total: number
  tone: 'success' | 'warning' | 'error'
  badge: string
  note: string
}

export const domains: DomainHealth[] = [
  { name: 'Sales & Orders', passing: 42, total: 42, tone: 'success', badge: 'Healthy', note: 'All null & count checks passing' },
  { name: 'Receivables', passing: 28, total: 30, tone: 'error', badge: '2 Failed', note: 'Duplicate invoices & $420 variance' },
  { name: 'Inventory', passing: 31, total: 32, tone: 'warning', badge: '1 Warning', note: 'Feed delayed 3h past SLA' },
  { name: 'Purchasing', passing: 24, total: 24, tone: 'success', badge: 'Healthy', note: 'Reconciled with ERP POs' },
]

export type SchemaChange = {
  id: string
  kind: 'non-breaking' | 'breaking'
  dataset: string
  detected: string
  businessSummary: { before: string; field: string; after: string }
  technical: string
}

export const schemaChanges: SchemaChange[] = [
  {
    id: 'sc-1',
    kind: 'non-breaking',
    dataset: 'public.orders',
    detected: '2026-11-20T14:15:00Z',
    businessSummary: {
      before: 'A new field (',
      field: 'tax_region',
      after: ') was added to Orders. Existing sales reports continue working normally.',
    },
    technical: '+ ADD COLUMN tax_region VARCHAR(16) NULL',
  },
]

export type ImpactRow = {
  report: string
  incidentId: string
  risk: string
  owner: string
  /** Status shown while the linked incident is open. */
  openStatus: { tone: 'error' | 'warning'; label: string }
}

export const impacts: ImpactRow[] = [
  {
    report: 'Executive Finance — Net Receivables',
    incidentId: 'INC-204',
    risk: 'Overstated by ~$18,450 until deduplicated',
    owner: 'Finance Team',
    openStatus: { tone: 'error', label: 'Warning banner shown' },
  },
  {
    report: 'Warehouse Reorder Alerting',
    incidentId: 'INC-203',
    risk: 'Using 09:00 UTC stock snapshot',
    owner: 'Operations Lead',
    openStatus: { tone: 'warning', label: 'Delayed' },
  },
]

/** Static overview metrics that are not derived from incident/freshness state. */
export const overviewStatic = {
  reliability: '~94%',
  healthyDatasets: 38,
  needsAttention: 4,
  failedChecks: 3,
  failedChecksCaption: 'Across 2 tables',
}
