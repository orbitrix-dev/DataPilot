/**
 * Mock Automate data. Workflows, approval requests and runs are seeded so the
 * figures agree with the other modules: invoices come from the Insights
 * receivables, stock rows and lead times from Insights inventory and suppliers,
 * and Trust dataset names and incidents (INC-204 on public.invoices, INC-203 /
 * stale warehouse.stock_levels) are reused. Where the Stitch designs disagreed
 * with that data, the existing data wins; see docs/BUILD_NOTES.md.
 *
 * All times are UTC, like Trust. "Today" is Fri Nov 20, 2026.
 */
import { stock, suppliers } from '../insights/data'

/* ---------------------------------------------------------------- catalogs */

export type DatasetId = 'public.invoices' | 'warehouse.stock_levels' | 'connect.sync_runs'
export type FieldType = 'number' | 'text'
export type Field = { name: string; type: FieldType; label: string }

export type Dataset = {
  id: DatasetId
  label: string
  /** Connect source the dataset is read from. */
  source: string
  /** What one row is, singular and plural ("invoice" / "invoices"). */
  noun: [string, string]
  fields: Field[]
  /** Trust dependency used for the freshness gate and approval warnings. */
  trust: 'invoices' | 'stock' | 'none'
}

export const datasets: Dataset[] = [
  {
    id: 'public.invoices',
    label: 'public.invoices',
    source: 'PostgreSQL — Production ERP',
    noun: ['past-due invoice', 'past-due invoices'],
    fields: [
      { name: 'days_overdue', type: 'number', label: 'Days overdue' },
      { name: 'balance_due', type: 'number', label: 'Balance due ($)' },
      { name: 'customer_tier', type: 'text', label: 'Customer tier' },
    ],
    trust: 'invoices',
  },
  {
    id: 'warehouse.stock_levels',
    label: 'warehouse.stock_levels',
    source: 'MySQL — Warehouse Inventory',
    noun: ['SKU', 'SKUs'],
    fields: [
      { name: 'days_of_cover', type: 'number', label: 'Days of cover' },
      { name: 'lead_time_days', type: 'number', label: 'Supplier lead time (days)' },
      { name: 'velocity', type: 'text', label: 'Velocity' },
    ],
    trust: 'stock',
  },
  {
    id: 'connect.sync_runs',
    label: 'connect.sync_runs',
    source: 'Connect telemetry',
    noun: ['sync run', 'sync runs'],
    fields: [
      { name: 'status', type: 'text', label: 'Status' },
      { name: 'duration_seconds', type: 'number', label: 'Duration (seconds)' },
    ],
    trust: 'none',
  },
]

export const datasetById = (id: string) => datasets.find((d) => d.id === id)

export type TriggerKind = 'threshold' | 'schedule'

export type CadenceId = 'weekdays-0700' | 'daily-1200' | 'monday-0800' | 'after-sync'

/** `next` is the next evaluation after now (Fri Nov 20, ~14:30 UTC). */
export const cadences: { id: CadenceId; label: string; short: string; next?: string }[] = [
  { id: 'weekdays-0700', label: 'Every weekday at 07:00', short: 'Weekdays 07:00', next: 'Nov 23, 07:00' },
  { id: 'daily-1200', label: 'Every day at 12:00', short: 'Daily 12:00', next: 'Nov 21, 12:00' },
  { id: 'monday-0800', label: 'Every Monday at 08:00', short: 'Every Monday 08:00', next: 'Nov 23, 08:00' },
  { id: 'after-sync', label: 'Immediately after each sync', short: 'After each sync' },
]

export const cadenceById = (id: string) => cadences.find((c) => c.id === id)

export type ActionTypeId = 'email-owner' | 'slack-purchasing' | 'ar-task' | 'sales-report' | 'page-ops'

export type ActionType = {
  id: ActionTypeId
  label: string
  short: string
  icon: string
  scopes: string[]
  /** Label and placeholder for the recipient field. */
  targetLabel: string
  targetPlaceholder: string
  targetKind: 'email' | 'channel' | 'text'
  /** What the action can never do, shown in the permission preview. */
  limits: string
  /** Read-only alerts run without a human approval step. */
  preApproved?: boolean
}

export const actionTypes: ActionType[] = [
  {
    id: 'email-owner',
    label: 'Send email notification to owner',
    short: 'Email owner',
    icon: 'mail',
    scopes: ['notifications:send'],
    targetLabel: 'Recipient email',
    targetPlaceholder: 'owner@acme.io',
    targetKind: 'email',
    limits: 'Cannot modify ERP records or issue refunds.',
  },
  {
    id: 'slack-purchasing',
    label: 'Post alert to purchasing channel',
    short: 'Purchasing Slack alert',
    icon: 'forum',
    scopes: ['slack:post'],
    targetLabel: 'Slack channel',
    targetPlaceholder: '#purchasing-ops',
    targetKind: 'channel',
    limits: 'Cannot create or send purchase orders.',
  },
  {
    id: 'ar-task',
    label: 'Create follow-up task in Receivables',
    short: 'Create AR task',
    icon: 'task_alt',
    scopes: ['tasks:write'],
    targetLabel: 'Task queue',
    targetPlaceholder: 'Collections queue',
    targetKind: 'text',
    limits: 'Cannot contact customers or change invoice balances.',
  },
  {
    id: 'sales-report',
    label: 'Generate and deliver weekly sales report',
    short: 'PDF report to executives',
    icon: 'picture_as_pdf',
    scopes: ['reports:export', 'mail:send'],
    targetLabel: 'Recipient email',
    targetPlaceholder: 'executives@acme.io',
    targetKind: 'email',
    limits: 'Read-only export. Cannot change report definitions.',
  },
  {
    id: 'page-ops',
    label: 'Page operations on-call',
    short: 'Ops pager',
    icon: 'notifications_active',
    scopes: ['pager:notify'],
    targetLabel: 'Pager rotation',
    targetPlaceholder: 'ops-oncall',
    targetKind: 'text',
    limits: 'Read-only alert. Cannot restart or change connections.',
    preApproved: true,
  },
]

export const actionTypeById = (id: string) => actionTypes.find((a) => a.id === id)

export type ApproverId = 'finance' | 'owner' | 'ops'

export const approvers: { id: ApproverId; label: string; short: string; people: string }[] = [
  { id: 'finance', label: 'Finance Manager or Workspace Owner', short: 'Finance Mgr', people: 'Finance Manager, Owner' },
  { id: 'owner', label: 'Workspace Owner only', short: 'Owner', people: 'Workspace Owner' },
  { id: 'ops', label: 'Operations Lead', short: 'Ops Lead', people: 'Operations Lead' },
]

export const approverById = (id: string) => approvers.find((a) => a.id === id)

export type RetryId = 'backoff-3' | 'once-5m'

export const retryPolicies: { id: RetryId; label: string; max: number }[] = [
  { id: 'backoff-3', label: '3 retries with exponential backoff, then alert Ops', max: 3 },
  { id: 'once-5m', label: '1 retry after 5m, then halt', max: 1 },
]

export const retryById = (id: string) => retryPolicies.find((r) => r.id === id)

export type Op = '>' | '>=' | '<' | '<=' | '=='

export const ops: { id: Op; label: string }[] = [
  { id: '>', label: 'greater than (>)' },
  { id: '>=', label: 'greater than or equal (>=)' },
  { id: '<', label: 'less than (<)' },
  { id: '<=', label: 'less than or equal (<=)' },
  { id: '==', label: 'equals (==)' },
]

/* --------------------------------------------------------------- workflows */

export type Rule = { field: string; op: Op; value: string }

export type Trigger = { kind: TriggerKind; dataset: DatasetId | ''; cadence: CadenceId | ''; trustGate: boolean }
export type Conditions = { match: 'all' | 'any'; rules: Rule[] }
export type Action = { type: ActionTypeId | ''; target: string; approver: ApproverId; retry: RetryId }

export type WorkflowState = 'draft' | 'published' | 'paused'

/** `at` is set on entries created during the session (ms since epoch), for cross-module ordering. */
export type AuditEntry = { text: string; actor: string; time: string; at?: number }

export type Workflow = {
  id: string
  name: string
  state: WorkflowState
  /** Published version; 0 while it has never been published. */
  version: number
  trigger: Trigger
  conditions: Conditions
  action: Action
  /** Stages the user has saved at least once (templates arrive configured). */
  configured: { trigger: boolean; conditions: boolean; action: boolean }
  /** Set when the configuration changed after the last publish. */
  unpublishedChanges?: boolean
  /** Last evaluation (scan or event), shown on the overview. */
  lastRun?: string
  audit: AuditEntry[]
}

export const PEOPLE = {
  elena: 'Elena Vance (Finance Manager)',
  marcus: 'Marcus Chen (Workspace Owner)',
  priya: 'Priya Raman (Operations Lead)',
}

const allConfigured = { trigger: true, conditions: true, action: true }

export const seedWorkflows: Workflow[] = [
  {
    id: 'WF-104',
    name: 'Notify owner when customer invoice becomes overdue',
    state: 'published',
    version: 2,
    trigger: { kind: 'threshold', dataset: 'public.invoices', cadence: 'weekdays-0700', trustGate: true },
    conditions: {
      match: 'all',
      rules: [
        { field: 'days_overdue', op: '>', value: '15' },
        { field: 'balance_due', op: '>=', value: '5000' },
      ],
    },
    action: { type: 'email-owner', target: 'owner@acme.io', approver: 'finance', retry: 'backoff-3' },
    configured: allConfigured,
    lastRun: 'Today, 07:00',
    audit: [
      { text: 'Approved run RUN-8842', actor: PEOPLE.elena, time: 'Today, 08:15' },
      { text: 'Published workflow v2 (added Trust freshness gate)', actor: PEOPLE.marcus, time: 'Nov 15, 14:20' },
      { text: 'Published workflow v1', actor: PEOPLE.marcus, time: 'Nov 12, 09:30' },
      { text: 'Created from Marketplace template', actor: PEOPLE.marcus, time: 'Nov 12, 09:05' },
    ],
  },
  {
    id: 'WF-105',
    name: 'Alert purchasing team on low inventory threshold',
    state: 'published',
    version: 1,
    trigger: { kind: 'threshold', dataset: 'warehouse.stock_levels', cadence: 'daily-1200', trustGate: false },
    conditions: { match: 'all', rules: [{ field: 'days_of_cover', op: '<', value: 'lead_time_days' }] },
    action: { type: 'slack-purchasing', target: '#purchasing-ops', approver: 'ops', retry: 'once-5m' },
    configured: allConfigured,
    lastRun: 'Today, 12:00',
    audit: [
      { text: 'Approved run RUN-8840', actor: PEOPLE.priya, time: 'Yesterday, 12:40' },
      { text: 'Ran dry-run test RUN-8839', actor: PEOPLE.priya, time: 'Yesterday, 11:20' },
      { text: 'Published workflow v1', actor: PEOPLE.marcus, time: 'Nov 13, 16:05' },
      { text: 'Created from Marketplace template', actor: PEOPLE.marcus, time: 'Nov 13, 15:40' },
    ],
  },
  {
    id: 'WF-106',
    name: 'Generate and send weekly sales report after approval',
    state: 'published',
    version: 1,
    trigger: { kind: 'schedule', dataset: '', cadence: 'monday-0800', trustGate: true },
    conditions: { match: 'all', rules: [] },
    action: { type: 'sales-report', target: 'executives@acme.io', approver: 'owner', retry: 'backoff-3' },
    configured: allConfigured,
    lastRun: 'Nov 16, 08:00',
    audit: [
      { text: 'Approved run RUN-8835', actor: PEOPLE.marcus, time: 'Nov 16, 08:04' },
      { text: 'Published workflow v1', actor: PEOPLE.marcus, time: 'Nov 10, 11:15' },
      { text: 'Created from Marketplace template', actor: PEOPLE.marcus, time: 'Nov 10, 10:50' },
    ],
  },
  {
    id: 'WF-107',
    name: 'Notify operations when a data sync fails',
    state: 'paused',
    version: 1,
    trigger: { kind: 'threshold', dataset: 'connect.sync_runs', cadence: 'after-sync', trustGate: false },
    conditions: { match: 'all', rules: [{ field: 'status', op: '==', value: 'failed' }] },
    action: { type: 'page-ops', target: 'ops-oncall', approver: 'ops', retry: 'backoff-3' },
    configured: allConfigured,
    lastRun: 'Nov 16, 14:22',
    audit: [
      { text: 'Paused workflow (pager rotation being updated)', actor: PEOPLE.priya, time: 'Nov 16, 15:00' },
      { text: 'Paged operations: Databricks sync failed (RUN-8834)', actor: 'Automate (pre-approved alert)', time: 'Nov 16, 14:22' },
      { text: 'Published workflow v1', actor: PEOPLE.priya, time: 'Nov 9, 10:00' },
    ],
  },
  {
    id: 'WF-108',
    name: 'Create follow-up task for overdue customer payments',
    state: 'draft',
    version: 0,
    trigger: { kind: 'threshold', dataset: 'public.invoices', cadence: 'weekdays-0700', trustGate: true },
    conditions: { match: 'all', rules: [{ field: 'days_overdue', op: '>', value: '30' }] },
    action: { type: 'ar-task', target: 'Collections queue', approver: 'finance', retry: 'backoff-3' },
    configured: { trigger: true, conditions: true, action: false },
    audit: [{ text: 'Created from Marketplace template', actor: PEOPLE.elena, time: 'Nov 19, 16:30' }],
  },
]

/* --------------------------------------------------------------- templates */

export type Template = {
  id: string
  name: string
  workflowName: string
  category: string
  description: string
  trigger: Trigger
  conditions: Conditions
  action: Action
}

export const templates: Template[] = [
  {
    id: 'overdue-invoice-alert',
    name: 'Overdue invoice owner alert',
    workflowName: 'Notify owner when customer invoice becomes overdue',
    category: 'Receivables',
    description: 'Emails the account owner a digest of invoices more than 15 days overdue, only while Trust reports the invoice data as healthy.',
    trigger: seedWorkflows[0].trigger,
    conditions: seedWorkflows[0].conditions,
    action: seedWorkflows[0].action,
  },
  {
    id: 'low-inventory-alert',
    name: 'Low inventory purchasing alert',
    workflowName: 'Alert purchasing team on low inventory threshold',
    category: 'Inventory',
    description: 'Alerts the purchasing team when a SKU’s days of cover drops below its supplier lead time.',
    trigger: { ...seedWorkflows[1].trigger, trustGate: true },
    conditions: seedWorkflows[1].conditions,
    action: seedWorkflows[1].action,
  },
  {
    id: 'weekly-sales-report',
    name: 'Weekly sales report dispatch',
    workflowName: 'Generate and send weekly sales report after approval',
    category: 'Reporting',
    description: 'Generates the weekly wholesale sales summary every Monday and queues it for owner approval before sending.',
    trigger: seedWorkflows[2].trigger,
    conditions: seedWorkflows[2].conditions,
    action: seedWorkflows[2].action,
  },
  {
    id: 'sync-failure-alert',
    name: 'Data sync failure notification',
    workflowName: 'Notify operations when a data sync fails',
    category: 'Operations',
    description: 'Pages operations as soon as a Connect sync job fails.',
    trigger: seedWorkflows[3].trigger,
    conditions: seedWorkflows[3].conditions,
    action: seedWorkflows[3].action,
  },
  {
    id: 'overdue-followup-task',
    name: 'Overdue payment follow-up task',
    workflowName: 'Create follow-up task for overdue customer payments',
    category: 'Collections',
    description: 'Creates a collections follow-up task for invoices 30+ days past due, pending Finance Manager sign-off.',
    trigger: seedWorkflows[4].trigger,
    conditions: seedWorkflows[4].conditions,
    action: seedWorkflows[4].action,
  },
]

/* ------------------------------------------------------------ sample rows */

export type Row = Record<string, string | number>

/**
 * Past-due invoices in the current public.invoices snapshot. Each customer's
 * invoices sum to its "overdue" figure in the Insights receivables table.
 * Only two invoices are both over 15 days overdue and at least $5,000.
 */
export const invoiceRows: Row[] = [
  { id: 'INV-3702', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_800, days_overdue: 94 },
  { id: 'INV-3711', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_950, days_overdue: 93 },
  { id: 'INV-3724', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_600, days_overdue: 92 },
  { id: 'INV-3730', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_700, days_overdue: 92 },
  { id: 'INV-3741', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_650, days_overdue: 91 },
  { id: 'INV-3748', customer: 'Apex Hardware Group', customer_tier: 'key', balance_due: 4_500, days_overdue: 91 },
  { id: 'INV-3790', customer: 'Riverbend Farm & Fleet', customer_tier: 'standard', balance_due: 4_980, days_overdue: 72 },
  { id: 'INV-3902', customer: 'Riverbend Farm & Fleet', customer_tier: 'standard', balance_due: 4_600, days_overdue: 55 },
  { id: 'INV-3995', customer: 'Riverbend Farm & Fleet', customer_tier: 'standard', balance_due: 4_600, days_overdue: 31 },
  { id: 'INV-3841', customer: 'Great Lakes Builders Co.', customer_tier: 'growth', balance_due: 4_100, days_overdue: 63 },
  { id: 'INV-3950', customer: 'Great Lakes Builders Co.', customer_tier: 'growth', balance_due: 4_100, days_overdue: 40 },
  { id: 'INV-4021', customer: 'Great Lakes Builders Co.', customer_tier: 'growth', balance_due: 11_200, days_overdue: 22 },
  { id: 'INV-3888', customer: 'Summit Contractors Supply', customer_tier: 'growth', balance_due: 1_400, days_overdue: 47 },
  { id: 'INV-4034', customer: 'Summit Contractors Supply', customer_tier: 'growth', balance_due: 7_200, days_overdue: 18 },
]

/** Supplier for each SKU, used for the lead time in the stock rows. */
const skuSupplier: Record<string, string> = {
  'SKU-4410': 'Pacific Steel & Alloys',
  'SKU-7730': 'Great Plains Packaging',
  'SKU-2108': 'Midwest Valve Mfg.',
  'SKU-5502': 'Pacific Steel & Alloys',
  'SKU-3317': 'Delta Polymer Products',
  'SKU-9021': 'Lakeshore Brass Works',
}

/** Insights stock rows with the supplier lead time added. */
export const stockRows: Row[] = stock.map((s) => ({
  id: s.sku,
  name: s.name,
  days_of_cover: s.daysOfCover,
  lead_time_days: suppliers.find((p) => p.name === skuSupplier[s.sku])?.leadTimeDays ?? 0,
  velocity: s.velocity.toLowerCase(),
}))

/* ------------------------------------------------------- approvals & runs */

export type RequestStatus = 'pending' | 'approved' | 'rejected'

export type ApprovalRequest = {
  id: string
  workflowId: string
  title: string
  detail: string
  queued: string
  /** Rows the request acts on, from the evaluation that queued it. */
  matched: string[]
  status: RequestStatus
  decidedBy?: string
  decidedAt?: string
  reason?: string
  runId?: string
}

export const seedRequests: ApprovalRequest[] = [
  {
    id: 'REQ-9041',
    workflowId: 'WF-106',
    title: 'Generate and send weekly sales report',
    detail:
      'Ad-hoc run requested by Marcus Chen for Monday’s board pack. Will email the PDF summary (week 4 revenue $824,420) to 14 executive recipients.',
    queued: 'Today, 14:20',
    matched: [],
    status: 'pending',
  },
  {
    id: 'REQ-9040',
    workflowId: 'WF-104',
    title: 'Notify owner of 2 overdue invoices ($18,400)',
    detail:
      'Great Lakes Builders Co. ($11,200 · 22d overdue) and Summit Contractors Supply ($7,200 · 18d overdue). Will email owner@acme.io.',
    queued: 'Today, 07:00',
    matched: ['INV-4021', 'INV-4034'],
    status: 'pending',
  },
  {
    id: 'REQ-9038',
    workflowId: 'WF-105',
    title: 'Alert purchasing team on low stock (SKU-4410, SKU-2108)',
    detail:
      'Stainless Fasteners has 5 days of cover against a 7.5-day lead time; Hydraulic Valve 24V has 11 against 12.4. Will post a reorder alert to #purchasing-ops.',
    queued: 'Today, 12:00',
    matched: ['SKU-4410', 'SKU-2108'],
    status: 'pending',
  },
]

export type StepStatus = 'ok' | 'error' | 'skipped' | 'running'
export type Step = { title: string; detail: string; time: string; status: StepStatus; note?: string }

export type RunOutcome = 'executed' | 'failed' | 'running' | 'test' | 'rejected'

export type Run = {
  id: string
  workflowId: string
  requestId?: string
  outcome: RunOutcome
  /** "Elena Vance", "Dry run (test)", "Pre-approved alert". */
  approvedBy: string
  time: string
  /** Counted in the 7-day KPIs (all seeded runs are within Nov 14–20). */
  inLast7d: boolean
  summary: string
  steps: Step[]
  /** Delivery retries used, for failed runs. */
  retriesUsed?: number
  /** When the run was created or last changed in this session (ms since epoch). */
  at?: number
}

export const seedRuns: Run[] = [
  {
    id: 'RUN-8842',
    workflowId: 'WF-104',
    requestId: 'REQ-9036',
    outcome: 'failed',
    approvedBy: 'Elena Vance',
    time: 'Today, 08:15',
    inLast7d: true,
    summary: 'Owner digest for INV-4021 and INV-4034 ($18,400)',
    retriesUsed: 3,
    steps: [
      { title: 'Trigger evaluated', detail: 'Scanned 14 past-due invoices in public.invoices. Trust status: healthy.', time: 'Nov 19, 07:00:01', status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: '2 invoices matched (>15d overdue, ≥$5,000): INV-4021, INV-4034.', time: 'Nov 19, 07:00:02', status: 'ok', note: '2 rows' },
      { title: 'Human approval verified', detail: 'REQ-9036 approved by Elena Vance (Finance Manager) in the Approval Center.', time: 'Today, 08:15:40', status: 'ok', note: 'Approved' },
      {
        title: 'Action failed (mail relay timeout)',
        detail: 'Mail relay timed out after 10,000 ms. 3 automatic retries (08:16, 08:18, 08:22) also timed out; Ops was alerted. Nothing was sent.',
        time: 'Today, 08:22:51',
        status: 'error',
        note: 'Error',
      },
    ],
  },
  {
    id: 'RUN-8841',
    workflowId: 'WF-104',
    requestId: 'REQ-9033',
    outcome: 'executed',
    approvedBy: 'Elena Vance',
    time: 'Yesterday, 08:02',
    inLast7d: true,
    summary: 'Owner digest for INV-4021 and INV-4034 ($18,400)',
    steps: [
      { title: 'Trigger evaluated', detail: 'Scanned 14 past-due invoices in public.invoices. Trust status: healthy.', time: 'Nov 18, 07:00:01', status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: '2 invoices matched: INV-4021, INV-4034.', time: 'Nov 18, 07:00:02', status: 'ok', note: '2 rows' },
      { title: 'Human approval verified', detail: 'REQ-9033 approved by Elena Vance (Finance Manager).', time: 'Yesterday, 08:01:48', status: 'ok', note: 'Approved' },
      { title: 'Action executed', detail: 'Digest emailed to owner@acme.io.', time: 'Yesterday, 08:02:03', status: 'ok', note: 'Sent' },
    ],
  },
  {
    id: 'RUN-8840',
    workflowId: 'WF-105',
    requestId: 'REQ-9034',
    outcome: 'executed',
    approvedBy: 'Priya Raman',
    time: 'Yesterday, 12:40',
    inLast7d: true,
    summary: 'Reorder alert for SKU-4410 and SKU-2108',
    steps: [
      { title: 'Trigger evaluated', detail: 'Read 6 SKUs from warehouse.stock_levels. Trust status: on time.', time: 'Yesterday, 12:00:01', status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: '2 SKUs below supplier lead time: SKU-4410, SKU-2108.', time: 'Yesterday, 12:00:01', status: 'ok', note: '2 rows' },
      { title: 'Human approval verified', detail: 'REQ-9034 approved by Priya Raman (Operations Lead).', time: 'Yesterday, 12:39:55', status: 'ok', note: 'Approved' },
      { title: 'Action executed', detail: 'Alert posted to #purchasing-ops.', time: 'Yesterday, 12:40:02', status: 'ok', note: 'Posted' },
    ],
  },
  {
    id: 'RUN-8839',
    workflowId: 'WF-105',
    outcome: 'test',
    approvedBy: 'Dry run (test)',
    time: 'Yesterday, 11:20',
    inLast7d: false,
    summary: 'Dry run: 2 SKUs would match',
    steps: [
      { title: 'Trigger evaluated', detail: 'Read 6 SKUs from warehouse.stock_levels.', time: 'Yesterday, 11:20:04', status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: '2 SKUs below supplier lead time: SKU-4410, SKU-2108.', time: 'Yesterday, 11:20:04', status: 'ok', note: '2 rows' },
      { title: 'Approval step simulated', detail: 'Would queue 1 approval request for the Operations Lead.', time: 'Yesterday, 11:20:04', status: 'skipped', note: 'Simulated' },
      { title: 'Action not sent', detail: 'Dry run: no message was posted.', time: 'Yesterday, 11:20:04', status: 'skipped', note: 'Dry run' },
    ],
  },
  {
    id: 'RUN-8838',
    workflowId: 'WF-104',
    requestId: 'REQ-9030',
    outcome: 'executed',
    approvedBy: 'Elena Vance',
    time: 'Nov 18, 07:48',
    inLast7d: true,
    summary: 'Owner digest for INV-4021 ($11,200)',
    steps: simpleSteps('Nov 17, 07:00', 'Nov 18, 07:48', 'Elena Vance (Finance Manager)', 'Digest emailed to owner@acme.io.'),
  },
  {
    id: 'RUN-8837',
    workflowId: 'WF-105',
    requestId: 'REQ-9029',
    outcome: 'executed',
    approvedBy: 'Priya Raman',
    time: 'Nov 17, 12:31',
    inLast7d: true,
    summary: 'Reorder alert for SKU-4410',
    steps: simpleSteps('Nov 17, 12:00', 'Nov 17, 12:31', 'Priya Raman (Operations Lead)', 'Alert posted to #purchasing-ops.'),
  },
  {
    id: 'RUN-8836',
    workflowId: 'WF-104',
    requestId: 'REQ-9027',
    outcome: 'executed',
    approvedBy: 'Elena Vance',
    time: 'Nov 17, 07:55',
    inLast7d: true,
    summary: 'Owner digest for INV-4021 ($11,200)',
    steps: simpleSteps('Nov 16, 07:00', 'Nov 17, 07:55', 'Elena Vance (Finance Manager)', 'Digest emailed to owner@acme.io.'),
  },
  {
    id: 'RUN-8835',
    workflowId: 'WF-106',
    requestId: 'REQ-9025',
    outcome: 'executed',
    approvedBy: 'Marcus Chen',
    time: 'Nov 16, 08:04',
    inLast7d: true,
    summary: 'Weekly sales report (week 3, $738,600) to 14 recipients',
    steps: simpleSteps('Nov 16, 08:00', 'Nov 16, 08:04', 'Marcus Chen (Workspace Owner)', 'PDF report emailed to executives@acme.io (14 recipients).'),
  },
  {
    id: 'RUN-8834',
    workflowId: 'WF-107',
    outcome: 'executed',
    approvedBy: 'Pre-approved alert',
    time: 'Nov 16, 14:22',
    inLast7d: true,
    summary: 'Paged ops-oncall: Databricks sync failed',
    steps: [
      { title: 'Trigger evaluated', detail: 'Sync run for Databricks — Analytics Lakehouse finished.', time: 'Nov 16, 14:22:10', status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: 'status == failed.', time: 'Nov 16, 14:22:10', status: 'ok', note: '1 row' },
      { title: 'Approval not required', detail: 'Read-only pager alerts are pre-approved by policy.', time: 'Nov 16, 14:22:10', status: 'skipped', note: 'Pre-approved' },
      { title: 'Action executed', detail: 'Paged ops-oncall.', time: 'Nov 16, 14:22:12', status: 'ok', note: 'Paged' },
    ],
  },
]

function simpleSteps(evaluated: string, executed: string, approver: string, result: string): Step[] {
  return [
    { title: 'Trigger evaluated', detail: 'Scheduled evaluation completed. Trust status: healthy.', time: `${evaluated}:01`, status: 'ok', note: 'OK' },
    { title: 'Conditions matched', detail: 'Matched rows recorded with the request.', time: `${evaluated}:02`, status: 'ok', note: 'Matched' },
    { title: 'Human approval verified', detail: `Approved by ${approver}.`, time: `${executed}:00`, status: 'ok', note: 'Approved' },
    { title: 'Action executed', detail: result, time: `${executed}:04`, status: 'ok', note: 'Sent' },
  ]
}
