/**
 * Mock Intelligence answers. Every figure comes from, or adds up to, the
 * Insights data (src/features/insights/data.ts) so the assistant and the
 * dashboards agree. Where the Stitch designs contradicted that data (product
 * names, incident ids, totals), the existing data wins; see docs/BUILD_NOTES.md.
 */
import { agingBuckets, headline, products, receivables, stock, weeklyRevenue } from '../insights/data'

/** Which Trust issue an answer depends on (mirrors the Insights TrustDependency). */
export type TrustDependency = 'invoices' | 'stock' | 'none'

export type AnswerKind = 'conversation' | 'comparison' | 'anomaly' | 'recommendation' | 'forecast'

export type MissingData = { title: string; detail: string }

export type Evidence = {
  sql: string
  rows: number
  ms: number
  missing: MissingData[]
}

export type Answer = {
  id: string
  question: string
  kind: AnswerKind
  dependsOn: TrustDependency
  /** Datasets cited by the answer. The first is the one whose freshness is shown. */
  sources: string[]
  calculation: string
  evidence: Evidence
  /** Words that route a typed question to this answer (all words of one entry must appear). */
  match: string[][]
}

const NO_CRM: MissingData = {
  title: 'Marketing campaign attribution unavailable',
  detail: 'DataPilot did not estimate ad-driven revenue because no CRM or ad platform is connected yet.',
}

export const AS_OF = 'Nov 20, 2026'

/* ----------------------------------------------------------------- answers */

export const answers: Answer[] = [
  {
    id: 'overdue-customers',
    question: 'Which customers have overdue payments?',
    kind: 'conversation',
    dependsOn: 'invoices',
    sources: ['public.invoices', 'public.customers'],
    calculation: 'Sum of balance_due where due_date < CURRENT_DATE - 60, deduplicated by invoice_no.',
    evidence: {
      sql: [
        'SELECT customer_id, SUM(balance_due) AS overdue',
        'FROM (',
        '  SELECT DISTINCT ON (invoice_no) *',
        '  FROM public.invoices',
        ') AS unique_invoices',
        "WHERE due_date < DATE '2026-11-20' - 60",
        '  AND balance_due > 0',
        'GROUP BY 1 ORDER BY 2 DESC;',
      ].join('\n'),
      rows: 3_416,
      ms: 62,
      missing: [
        {
          title: 'Payment promises are not tracked',
          detail: 'Collections notes and promised payment dates live outside DataPilot, so accounts with an agreed plan still count as overdue.',
        },
      ],
    },
    match: [['overdue'], ['late', 'pay'], ['unpaid'], ['receivable']],
  },
  {
    id: 'sales-comparison',
    question: 'Compare sales this month with last month.',
    kind: 'comparison',
    dependsOn: 'none',
    sources: ['public.orders'],
    calculation: 'Sum of net_amount by order week for the last 30 days (Oct 21 – Nov 20) against the 30 days before it.',
    evidence: {
      sql: [
        "SELECT DATE_TRUNC('week', order_date) AS wk,",
        '       SUM(net_amount) AS revenue',
        'FROM public.orders',
        "WHERE order_date >= '2026-09-21'",
        'GROUP BY 1 ORDER BY 1;',
      ].join('\n'),
      rows: headline.orders + headline.priorOrders,
      ms: 48,
      missing: [NO_CRM],
    },
    match: [['compare'], ['last', 'month'], ['this', 'month', 'sales'], ['month', 'over']],
  },
  {
    id: 'top-products',
    question: 'What were my top-selling products this month?',
    kind: 'comparison',
    dependsOn: 'none',
    sources: ['public.orders', 'public.sku_costs'],
    calculation: 'Net revenue and units by SKU over the last 30 days, ranked by revenue. Margin uses the SKU cost at time of sale.',
    evidence: {
      sql: [
        'SELECT l.sku, SUM(l.quantity) AS units,',
        '       SUM(l.net_amount) AS revenue',
        'FROM public.orders o',
        'JOIN public.order_lines l USING (order_id)',
        "WHERE o.order_date >= '2026-10-21'",
        'GROUP BY 1 ORDER BY revenue DESC LIMIT 5;',
      ].join('\n'),
      rows: 11_874,
      ms: 71,
      missing: [],
    },
    match: [['top', 'product'], ['best', 'sell'], ['top', 'selling'], ['top', 'sku']],
  },
  {
    id: 'growth-customers',
    question: 'Which customers contributed most to revenue growth?',
    kind: 'comparison',
    dependsOn: 'none',
    sources: ['public.orders', 'public.customers'],
    calculation: 'Change in net revenue per customer between the last 30 days and the prior 30 days, ranked by increase.',
    evidence: {
      sql: [
        'SELECT customer_id,',
        "  SUM(net_amount) FILTER (WHERE order_date >= '2026-10-21')",
        "  - SUM(net_amount) FILTER (WHERE order_date < '2026-10-21') AS growth",
        'FROM public.orders',
        "WHERE order_date >= '2026-09-21'",
        'GROUP BY 1 ORDER BY growth DESC;',
      ].join('\n'),
      rows: headline.orders + headline.priorOrders,
      ms: 54,
      missing: [NO_CRM],
    },
    match: [['customer', 'growth'], ['contribut'], ['grew'], ['growing', 'customer']],
  },
  {
    id: 'revenue-decline',
    question: 'Why did revenue decline this week?',
    kind: 'anomaly',
    dependsOn: 'stock',
    sources: ['public.invoices', 'public.shipments', 'warehouse.stock_levels'],
    calculation: "Compared this week's Mon–Fri invoiced wholesale revenue (status = 'invoiced') with the Mon–Fri average of the prior 4 weeks.",
    evidence: {
      sql: [
        "SELECT DATE_TRUNC('week', invoice_date) AS wk,",
        '       SUM(amount) AS invoiced',
        'FROM public.invoices',
        "WHERE status = 'invoiced'",
        "  AND channel = 'wholesale'",
        '  AND EXTRACT(ISODOW FROM invoice_date) <= 5',
        "  AND invoice_date >= '2026-10-19'",
        'GROUP BY 1 ORDER BY 1;',
      ].join('\n'),
      rows: 1_688,
      ms: 83,
      missing: [
        {
          title: 'Dispatch status may be up to 3 hours old',
          detail: 'Held-order counts come from the warehouse export, which follows warehouse.stock_levels. Orders dispatched since the last export still count as held.',
        },
      ],
    },
    match: [['revenue', 'decline'], ['revenue', 'drop'], ['why', 'revenue'], ['sales', 'down']],
  },
  {
    id: 'stockout-risk',
    question: 'Which products are at risk of running out of stock?',
    kind: 'recommendation',
    dependsOn: 'stock',
    sources: ['warehouse.stock_levels', 'public.orders', 'public.purchase_orders'],
    calculation: 'Days of cover = on hand ÷ 30-day average daily units. SKUs whose days of cover are below the supplier lead time are flagged.',
    evidence: {
      sql: [
        'SELECT s.sku, s.on_hand,',
        '       d.units_30d / 30.0 AS avg_daily,',
        '       s.on_hand / NULLIF(d.units_30d / 30.0, 0) AS days_cover',
        'FROM warehouse.stock_levels s',
        'JOIN demand_30d d USING (sku)',
        'WHERE s.on_hand / NULLIF(d.units_30d / 30.0, 0) < 14',
        'ORDER BY days_cover;',
      ].join('\n'),
      rows: 4_212,
      ms: 39,
      missing: [
        {
          title: 'Open purchase orders not netted off',
          detail: 'Supplier confirmations for open POs are not connected, so stock arriving in the next few days is not added to on-hand quantities.',
        },
      ],
    },
    match: [['stock', 'out'], ['run', 'out'], ['running', 'out'], ['reorder'], ['low', 'stock'], ['inventory', 'risk']],
  },
  {
    id: 'forecast',
    question: '30-day wholesale revenue & demand projection',
    kind: 'forecast',
    dependsOn: 'none',
    sources: ['public.orders', 'public.customers'],
    calculation: '16-week additive seasonal baseline with 4-week momentum weighting.',
    evidence: {
      sql: [
        "SELECT DATE_TRUNC('week', order_date) AS wk,",
        '       SUM(net_amount) AS revenue, COUNT(*) AS orders',
        'FROM public.orders',
        "WHERE channel = 'wholesale'",
        "  AND order_date >= '2026-07-27'",
        "  AND order_date <  '2026-11-16'",
        'GROUP BY 1 ORDER BY 1;',
      ].join('\n'),
      rows: 14_820,
      ms: 112,
      missing: [
        {
          title: 'No supplier disruption signal',
          detail: 'Supplier delivery forecasts are not connected, so the projection assumes no unscheduled supply disruptions.',
        },
        NO_CRM,
      ],
    },
    match: [['forecast'], ['project'], ['predict'], ['next', 'month']],
  },
]

export const findAnswer = (id: string | undefined) => answers.find((a) => a.id === id)

/** The six example questions on the home page, in design order. */
export const exampleIds = [
  'top-products',
  'overdue-customers',
  'stockout-risk',
  'revenue-decline',
  'sales-comparison',
  'growth-customers',
]

/** Where an answer is rendered. */
export function answerPath(a: Pick<Answer, 'id' | 'kind'>): string {
  return a.kind === 'forecast' ? '/intelligence/forecast' : `/intelligence/answers/${a.id}`
}

/** Asks a question through the router, so it is recorded in history. */
export const askPath = (question: string) => `/intelligence/ask?q=${encodeURIComponent(question)}`

/* -------------------------------------------------------- overdue payments */

const over60 = agingBuckets.filter((b) => b.label.startsWith('61') || b.label.startsWith('90'))
const apex = receivables.find((r) => r.customer === 'Apex Hardware Group')!

export const overdue = {
  /** 61–90 + 90+ aging buckets: $70,380. */
  total: over60.reduce((s, b) => s + b.value, 0),
  accounts: 12,
  largest: { customer: apex.customer, amount: apex.overdue },
  rows: receivables.filter((r) => r.oldestDays > 60).sort((a, b) => b.overdue - a.overdue),
}

/* -------------------------------------------------------- sales comparison */

/** Prior 30-day window split into the same four weeks; sums to headline.priorRevenue. */
export const priorWeeklyRevenue = [590_200, 618_400, 652_900, 689_610]

export const weeklyComparison = weeklyRevenue.map((w, i) => ({
  label: w.label,
  current: w.value,
  prior: priorWeeklyRevenue[i],
}))

/* ------------------------------------------------------------ top products */

export const topProducts = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 5)

/* -------------------------------------------------------- growth customers */

/** Change in 30-day revenue by customer. Sums to the +$290,810 headline growth. */
export const growthByCustomer = [
  { name: 'Midwest Industrial Supply', growth: 68_400 },
  { name: 'Apex Hardware Group', growth: 51_200 },
  { name: 'Great Lakes Builders Co.', growth: 39_700 },
  { name: 'Summit Contractors Supply', growth: 28_900 },
  { name: 'Riverbend Farm & Fleet', growth: 17_300 },
]
export const growthOther = headline.revenue - headline.priorRevenue - growthByCustomer.reduce((s, c) => s + c.growth, 0)

/* ------------------------------------------------------------ revenue drop */

export const decline = {
  range: 'Nov 16–20 (Mon–Fri) vs. Mon–Fri average of Oct 19 – Nov 13',
  baseline: 308_600,
  drivers: [
    { label: 'Midwest warehouse dispatch delay (34 orders held)', amount: 21_800, tone: 'error' as const },
    { label: 'Account restock cycle shift (Northstar & Valley Supply)', amount: 12_400, tone: 'warning' as const },
    { label: 'Normal SKU mix variance', amount: 4_200, tone: 'neutral' as const },
  ],
  heldOrders: 34,
  shiftedAccounts: 'Northstar & Valley Supply',
}
export const declineTotal = decline.drivers.reduce((s, d) => s + d.amount, 0)
export const declineThisWeek = decline.baseline - declineTotal

/* ----------------------------------------------------------- stock-out risk */

/**
 * Numeric stock inputs for the SKUs under the 14-day reorder threshold in
 * Insights. On-hand and days of cover match insights/data.ts `stock`;
 * lead times come from each SKU's main supplier.
 */
const stockInputs: Record<string, { onHand: number; unit: string; leadDays: number; supplier: string }> = {
  'SKU-4410': { onHand: 180, unit: 'cases', leadDays: 8, supplier: 'Pacific Steel & Alloys' },
  'SKU-7730': { onHand: 410, unit: 'rolls', leadDays: 7, supplier: 'Great Plains Packaging' },
  'SKU-2108': { onHand: 64, unit: 'units', leadDays: 12, supplier: 'Midwest Valve Mfg.' },
  'SKU-5502': { onHand: 220, unit: 'kits', leadDays: 10, supplier: 'Pacific Steel & Alloys' },
}

/** Days of safety stock to hold on top of the lead time when sizing an order. */
export const SAFETY_DAYS = 14

export type RiskLevel = 'critical' | 'at-risk' | 'watch'

export type StockRisk = {
  sku: string
  name: string
  onHand: number
  unit: string
  avgDaily: number
  daysOfCover: number
  leadDays: number
  supplier: string
  level: RiskLevel
  /** Units to order now, rounded up to 10; 0 when no action is needed. */
  suggested: number
}

export const stockRisks: StockRisk[] = stock
  .filter((s) => stockInputs[s.sku])
  .map((s) => {
    const input = stockInputs[s.sku]
    const avgDaily = input.onHand / s.daysOfCover
    const level: RiskLevel =
      s.daysOfCover < input.leadDays ? (input.leadDays - s.daysOfCover >= 3 ? 'critical' : 'at-risk') : 'watch'
    const needed = avgDaily * (input.leadDays + SAFETY_DAYS) - input.onHand
    return {
      sku: s.sku,
      name: products.find((p) => p.sku === s.sku)?.name ?? s.name,
      ...input,
      avgDaily,
      daysOfCover: s.daysOfCover,
      level,
      suggested: level === 'watch' ? 0 : Math.ceil(needed / 10) * 10,
    }
  })

/* ----------------------------------------------------------------- forecast */

export const forecastObserved = [
  { label: 'Wk -4', value: 312_000 },
  { label: 'Wk -3', value: 328_400 },
  { label: 'Wk -2', value: 306_100 },
  { label: 'Wk -1', value: 338_000 },
]
export const observedTotal = forecastObserved.reduce((s, w) => s + w.value, 0)
export const observedOrders = 1_412

/** Weekly projections for 12 weeks; 30/60/90 days show the first 4/8/12. */
export const forecastWeeks = [334_000, 340_000, 346_000, 342_000, 343_000, 347_000, 349_000, 347_000, 356_000, 360_000, 364_000, 367_000]

export type Horizon = 30 | 60 | 90

/** 80% band half-width per horizon; it widens the further out the forecast goes. */
export const horizonBand: Record<Horizon, number> = { 30: 7.4, 60: 9.4, 90: 11.3 }

export function forecastFor(h: Horizon) {
  const weeks = h / 7.5
  const values = forecastWeeks.slice(0, weeks)
  const total = values.reduce((s, v) => s + v, 0)
  /** Compared with the observed 4-week run rate over the same number of weeks. */
  const growth = (total / (observedTotal * (weeks / 4)) - 1) * 100
  const band = horizonBand[h]
  return { weeks, values, total, growth, band, low: total * (1 - band / 100), high: total * (1 + band / 100) }
}

/* ------------------------------------------------------------------ history */

export type HistoryStatus = 'verified' | 'qualified' | 'forecast' | 'unanswered'

export type HistoryEntry = {
  id: string
  question: string
  /** Answer opened by "Reopen"; absent when the question had no grounded answer. */
  answerId?: string
  sources: string[]
  status: HistoryStatus
  /** Trust issue that qualified the answer at query time. */
  qualifiedBy?: string
  asked: string
  /** Set on questions asked during the session (ms since epoch). */
  at?: number
}

export const seedHistory: HistoryEntry[] = [
  { id: 'h6', question: 'Which customers have overdue payments?', answerId: 'overdue-customers', sources: ['public.invoices', 'public.customers'], status: 'qualified', qualifiedBy: 'INC-204', asked: 'Today, 09:42' },
  { id: 'h5', question: 'Why did revenue decline this week?', answerId: 'revenue-decline', sources: ['public.invoices', 'public.shipments', 'warehouse.stock_levels'], status: 'qualified', qualifiedBy: 'Stale feed', asked: 'Today, 09:15' },
  { id: 'h4', question: 'Which products are at risk of running out of stock?', answerId: 'stockout-risk', sources: ['warehouse.stock_levels', 'public.orders'], status: 'qualified', qualifiedBy: 'Stale feed', asked: 'Yesterday, 16:30' },
  { id: 'h3', question: 'What were my top-selling products this month?', answerId: 'top-products', sources: ['public.orders', 'public.sku_costs'], status: 'verified', asked: 'Yesterday, 14:12' },
  { id: 'h2', question: '30-day wholesale revenue & demand projection', answerId: 'forecast', sources: ['public.orders', 'public.customers'], status: 'forecast', asked: 'Nov 18, 11:05' },
  { id: 'h1', question: 'Which customers contributed most to revenue growth?', answerId: 'growth-customers', sources: ['public.orders', 'public.customers'], status: 'verified', asked: 'Nov 17, 15:48' },
]
