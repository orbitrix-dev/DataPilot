/**
 * Mock Insights data. Values shown in the Stitch Insights screens are kept
 * as designed; rows the designs left out were added so that totals agree
 * across pages (regions sum to total revenue, category margins average to
 * the 24.8% headline, receivables split by region and tier sums to $412,680).
 */

export const PERIOD_LABEL = 'Last 30 days (Oct 21 – Nov 20)'

export const headline = {
  revenue: 2_841_920,
  priorRevenue: 2_551_110,
  orders: 1_942,
  priorOrders: 1_795,
  grossMarginPct: 24.8,
  outstanding: 412_680,
  inventoryValue: 1_184_500,
  lowStockSkus: 18,
}

/** Weekly revenue for the current 4 weeks. The prior 4-week average is drawn as a reference line. */
export const weeklyRevenue = [
  { label: 'Wk 1', value: 612_400 },
  { label: 'Wk 2', value: 666_500 },
  { label: 'Wk 3', value: 738_600 },
  { label: 'Wk 4', value: 824_420 },
]

/** Rolling 30-day revenue and orders by month. "Nov" is the current 30-day window. */
export const monthlyTrend = [
  { label: 'Jun', value: 1_804_300, orders: 1_301 },
  { label: 'Jul', value: 1_981_600, orders: 1_402 },
  { label: 'Aug', value: 2_162_900, orders: 1_520 },
  { label: 'Sep', value: 2_371_400, orders: 1_655 },
  { label: 'Oct', value: 2_551_110, orders: 1_795 },
  { label: 'Nov', value: 2_841_920, orders: 1_942 },
]

export type Region = 'Midwest' | 'Northeast' | 'South' | 'West'

export const regions: { name: Region; revenue: number; orders: number; receivables: number; marginPct: number }[] = [
  { name: 'Midwest', revenue: 1_120_400, orders: 760, receivables: 148_600, marginPct: 25.6 },
  { name: 'Northeast', revenue: 812_100, orders: 548, receivables: 118_300, marginPct: 24.9 },
  { name: 'South', revenue: 540_920, orders: 382, receivables: 92_480, marginPct: 23.8 },
  { name: 'West', revenue: 368_500, orders: 252, receivables: 53_300, marginPct: 23.4 },
]

export const customerTiers = [
  { name: 'Key accounts (top 10)', revenue: 971_940, orders: 344, receivables: 124_000, marginPct: 22.1 },
  { name: 'Growth accounts', revenue: 1_190_000, orders: 820, receivables: 176_880, marginPct: 25.6 },
  { name: 'Standard accounts', revenue: 679_980, orders: 778, receivables: 111_800, marginPct: 27.2 },
]

export const categories = [
  { name: 'Industrial Fasteners', revenue: 1_120_400, cogs: 802_200 },
  { name: 'Hydraulic Components', revenue: 940_120, cogs: 698_500 },
  { name: 'Packaging Supplies', revenue: 468_200, cogs: 389_500 },
  { name: 'Plumbing Fittings', revenue: 313_200, cogs: 246_924 },
]

export type Customer = { name: string; orders90d: number; aov: number; revenue90d: number }

export const customers: Customer[] = [
  { name: 'Midwest Industrial Supply', orders90d: 148, aov: 2_825, revenue90d: 418_200 },
  { name: 'Apex Hardware Group', orders90d: 112, aov: 2_793, revenue90d: 312_900 },
  { name: 'Great Lakes Builders Co.', orders90d: 96, aov: 2_752, revenue90d: 264_150 },
  { name: 'Summit Contractors Supply', orders90d: 81, aov: 2_640, revenue90d: 213_840 },
  { name: 'Riverbend Farm & Fleet', orders90d: 74, aov: 2_190, revenue90d: 162_060 },
  { name: 'Coastal Marine Hardware', orders90d: 52, aov: 2_410, revenue90d: 125_320 },
]

export const customerStats = { activeAccounts: 318, repeatRatePct: 78.4, top10SharePct: 34.2 }

export type Product = { sku: string; name: string; unitsSold: number; revenue: number; marginPct: number }

export const products: Product[] = [
  { sku: 'SKU-4410', name: 'Stainless Fasteners (Case/500)', unitsSold: 4_280, revenue: 342_100, marginPct: 28.4 },
  { sku: 'SKU-2108', name: 'Hydraulic Control Valve 24V', unitsSold: 910, revenue: 289_450, marginPct: 31.2 },
  { sku: 'SKU-7730', name: 'Industrial Pallet Wrap 80ga', unitsSold: 6_140, revenue: 214_800, marginPct: 14.6 },
  { sku: 'SKU-5502', name: 'Hex Bolt Assortment Kit', unitsSold: 1_860, revenue: 128_340, marginPct: 26.1 },
  { sku: 'SKU-3317', name: 'PVC Ball Valve 2"', unitsSold: 1_240, revenue: 96_720, marginPct: 19.8 },
  { sku: 'SKU-9021', name: 'Brass Coupler 1/2"', unitsSold: 2_310, revenue: 41_580, marginPct: 22.9 },
]

export type Velocity = 'Fast-moving' | 'Steady' | 'Slow-moving'

export type StockRow = { sku: string; name: string; onHand: string; daysOfCover: number; velocity: Velocity }

/** Reorder threshold from the design: under 14 days of cover. */
export const REORDER_DAYS = 14

export const stock: StockRow[] = [
  { sku: 'SKU-4410', name: 'Stainless Fasteners', onHand: '180 cases', daysOfCover: 5, velocity: 'Fast-moving' },
  { sku: 'SKU-7730', name: 'Industrial Pallet Wrap 80ga', onHand: '410 rolls', daysOfCover: 9, velocity: 'Fast-moving' },
  { sku: 'SKU-2108', name: 'Hydraulic Valve 24V', onHand: '64 units', daysOfCover: 11, velocity: 'Fast-moving' },
  { sku: 'SKU-5502', name: 'Hex Bolt Assortment Kit', onHand: '220 kits', daysOfCover: 13, velocity: 'Steady' },
  { sku: 'SKU-3317', name: 'PVC Ball Valve 2"', onHand: '540 units', daysOfCover: 38, velocity: 'Steady' },
  { sku: 'SKU-9021', name: 'Brass Coupler 1/2"', onHand: '1,420 units', daysOfCover: 118, velocity: 'Slow-moving' },
]

export const inventoryStats = { fastMoving: 142, slowMoving: 39 }

export type Supplier = { name: string; spend30d: number; onTimePct: number; leadTimeDays: number }

export const suppliers: Supplier[] = [
  { name: 'Pacific Steel & Alloys', spend30d: 482_000, onTimePct: 96.8, leadTimeDays: 7.5 },
  { name: 'Midwest Valve Mfg.', spend30d: 319_500, onTimePct: 84.2, leadTimeDays: 12.4 },
  { name: 'Great Plains Packaging', spend30d: 214_300, onTimePct: 93.1, leadTimeDays: 6.8 },
  { name: 'Lakeshore Brass Works', spend30d: 128_900, onTimePct: 90.5, leadTimeDays: 10.1 },
  { name: 'Delta Polymer Products', spend30d: 96_400, onTimePct: 88.0, leadTimeDays: 9.6 },
]

export const purchaseStats = { poSpend: 1_492_000, onTimePct: 92.4, leadTimeDays: 9.2 }

export const agingBuckets = [
  { label: '0–30 days', value: 248_100, tone: 'success' as const },
  { label: '31–60 days', value: 94_200, tone: 'neutral' as const },
  { label: '61–90 days', value: 42_180, tone: 'warning' as const },
  { label: '90+ days overdue', value: 28_200, tone: 'error' as const },
]

export type ReceivableRow = { customer: string; balance: number; overdue: number; oldestDays: number }

export const receivables: ReceivableRow[] = [
  { customer: 'Apex Hardware Group', balance: 84_200, overdue: 28_200, oldestDays: 94 },
  { customer: 'Riverbend Farm & Fleet', balance: 22_750, overdue: 14_180, oldestDays: 72 },
  { customer: 'Great Lakes Builders Co.', balance: 62_180, overdue: 19_400, oldestDays: 63 },
  { customer: 'Summit Contractors Supply', balance: 38_900, overdue: 8_600, oldestDays: 47 },
  { customer: 'Midwest Industrial Supply', balance: 71_400, overdue: 0, oldestDays: 24 },
]

/** Trust-linked identifiers shared with the Trust module. */
export const TRUST_LINKS = {
  invoicesIncident: 'INC-204',
  stockDataset: 'warehouse.stock_levels',
}
