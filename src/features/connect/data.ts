/**
 * Mock data for the Connect module. Everything rendered as a list, table or
 * card grid in the Connect screens comes from these typed arrays.
 */

export type ConnectionStatus = 'healthy' | 'latency' | 'failed' | 'verified'
export type ConnectionKind = 'database' | 'cloud' | 'file'

export type CredentialField = { label: string; value: string; secret?: boolean }

export type Connection = {
  id: string
  name: string
  /** Host, bucket or filename shown in mono under the name. */
  endpoint: string
  sourceType: string
  kind: ConnectionKind
  status: ConnectionStatus
  /** Display string, e.g. "1,120,400" or "0 (today)". */
  recordsLabel: string
  records: number
  /** ISO timestamp of the last successful sync. */
  lastSync: string
  accessLevel: string
  credentials: CredentialField[]
  /** Short reason surfaced in banners when status is `failed`. */
  issue?: string
  /** Last credential rotation: a time label, plus `at` (ms) when it happened during the session. Read by Admin. */
  rotated?: { time: string; by: string; at?: number }
}

export const connections: Connection[] = [
  {
    id: 'postgresql-production-erp',
    name: 'PostgreSQL — Production ERP',
    endpoint: 'db-prod-us-east.internal',
    sourceType: 'PostgreSQL',
    kind: 'database',
    status: 'healthy',
    recordsLabel: '1,120,400',
    records: 1120400,
    lastSync: '2026-11-20T14:28:00Z',
    accessLevel: 'Read-only (TLS 1.3)',
    rotated: { time: '2026-11-19T09:15:00Z', by: 'Elena Vance' },
    credentials: [
      { label: 'Username', value: 'datapilot_ro' },
      { label: 'Password / Secret', value: '••••••••••••••••', secret: true },
    ],
  },
  {
    id: 'mysql-warehouse-inventory',
    name: 'MySQL — Warehouse Inventory',
    endpoint: 'inv-replica.internal',
    sourceType: 'MySQL',
    kind: 'database',
    status: 'healthy',
    recordsLabel: '214,300',
    records: 214300,
    lastSync: '2026-11-20T14:15:00Z',
    accessLevel: 'Read-only (TLS 1.2)',
    credentials: [
      { label: 'Username', value: 'datapilot_select' },
      { label: 'Password / Secret', value: '••••••••••••••••', secret: true },
    ],
  },
  {
    id: 'databricks-analytics-lakehouse',
    name: 'Databricks — Analytics Lakehouse',
    endpoint: 'dbc-workspace-01',
    sourceType: 'Databricks',
    kind: 'cloud',
    status: 'latency',
    recordsLabel: '46,000',
    records: 46000,
    lastSync: '2026-11-20T13:50:00Z',
    accessLevel: 'Read-only (Unity Catalog)',
    credentials: [
      { label: 'Service principal', value: 'sp-datapilot-reader' },
      { label: 'Personal access token', value: '••••••••••••••••', secret: true },
    ],
  },
  {
    id: 'amazon-s3-raw-orders',
    name: 'Amazon S3 — Raw Orders',
    endpoint: 's3://acme-datapilot-orders',
    sourceType: 'Amazon S3',
    kind: 'cloud',
    status: 'failed',
    recordsLabel: '0 (today)',
    records: 0,
    lastSync: '2026-11-19T22:00:00Z',
    accessLevel: 'Read-only (IAM GetObject)',
    credentials: [
      { label: 'Access key ID', value: 'AKIA••••••••7Q2F' },
      { label: 'Secret access key', value: '••••••••••••••••', secret: true },
    ],
    issue: 'IAM access key expired at 09:44 UTC. Rotate credentials or retry the connection.',
  },
  {
    id: 'q4-regional-sales-export',
    name: 'Q4 Regional Sales Export',
    endpoint: 'orders_q4_2026.csv',
    sourceType: 'CSV File',
    kind: 'file',
    status: 'verified',
    recordsLabel: '48,210',
    records: 48210,
    lastSync: '2026-11-20T11:05:00Z',
    accessLevel: 'Read-only copy',
    credentials: [],
  },
]

/* ------------------------------------------------------------------ */
/* Overview KPIs                                                       */
/* ------------------------------------------------------------------ */

export type Kpi = {
  label: string
  icon?: string
  iconClassName?: string
  value: string
  valueClassName?: string
  caption: string
  captionClassName?: string
}

export const overviewKpis: Kpi[] = [
  { label: 'Connected sources', icon: 'hub', value: '7', caption: 'Databases, cloud & files' },
  {
    label: 'Records processed (24h)',
    icon: 'database',
    value: '1,428,910',
    caption: 'Read-only mode active',
    captionClassName: 'text-success',
  },
  {
    label: 'Last successful sync',
    icon: 'schedule',
    value: '4m ago',
    caption: 'Nov 20, 2026 · 14:28 UTC',
    captionClassName: 'tabular-nums',
  },
]

/* ------------------------------------------------------------------ */
/* Marketplace                                                         */
/* ------------------------------------------------------------------ */

export type SourceCategory = 'file' | 'database' | 'coming-soon'

export type DataSource = {
  id: string
  name: string
  description: string
  icon?: string
  category: SourceCategory
}

export const dataSources: DataSource[] = [
  { id: 'csv', name: 'CSV', icon: 'csv', category: 'file', description: 'Upload comma-separated exports from any accounting or sales tool.' },
  { id: 'excel', name: 'Excel (.xlsx / .xls)', icon: 'table_view', category: 'file', description: 'Import multi-sheet workbooks with automatic column type detection.' },
  { id: 'json', name: 'JSON', icon: 'data_object', category: 'file', description: 'Ingest structured JSON or newline-delimited NDJSON event files.' },
  { id: 'postgresql', name: 'PostgreSQL', icon: 'database', category: 'database', description: 'Read-only replica or SSL database connection.' },
  { id: 'mysql', name: 'MySQL', icon: 'storage', category: 'database', description: 'Incremental sync via read-only SELECT user.' },
  { id: 's3', name: 'Amazon S3', icon: 'cloud_queue', category: 'database', description: 'Read buckets via scoped IAM GetObject role.' },
  { id: 'databricks', name: 'Databricks', icon: 'layers', category: 'database', description: 'Connect SQL warehouses via Unity Catalog token.' },
  { id: 'sap', name: 'SAP S/4HANA', category: 'coming-soon', description: 'Enterprise ERP financials and supply chain.' },
  { id: 'netsuite', name: 'Oracle NetSuite', category: 'coming-soon', description: 'Cloud ERP orders, inventory, and billing.' },
  { id: 'salesforce', name: 'Salesforce', category: 'coming-soon', description: 'CRM accounts, opportunities, and pipeline.' },
  { id: 'hubspot', name: 'HubSpot', category: 'coming-soon', description: 'Marketing attribution and deal stages.' },
]

/* ------------------------------------------------------------------ */
/* New-connection wizard                                               */
/* ------------------------------------------------------------------ */

export type WizardStep = { path: string; label: string }

export const wizardSteps: WizardStep[] = [
  { path: 'source', label: 'Choose source' },
  { path: 'details', label: 'Connection details' },
  { path: 'access', label: 'Configure access' },
  { path: 'test', label: 'Test connection' },
  { path: 'datasets', label: 'Select datasets' },
  { path: 'sync', label: 'Initial sync' },
  { path: 'results', label: 'Results' },
]

export type SourceDataset = {
  name: string
  rows: number
  columns: number
  primaryKey: string
  cursor: string
  defaultSelected: boolean
}

export type SourcePreset = {
  sourceId: string
  label: string
  connectionName: string
  hostLabel: string
  host: string
  port: string
  databaseLabel: string
  database: string
  usernameLabel: string
  username: string
  secretLabel: string
  grantSql: string[]
  datasets: SourceDataset[]
}

export const sourcePresets: SourcePreset[] = [
  {
    sourceId: 'postgresql',
    label: 'PostgreSQL',
    connectionName: 'PostgreSQL — Production ERP',
    hostLabel: 'Host / Endpoint',
    host: 'db-prod-us-east.internal',
    port: '5432',
    databaseLabel: 'Database name',
    database: 'acme_erp_prod',
    usernameLabel: 'Read-only username',
    username: 'datapilot_ro',
    secretLabel: 'Password',
    grantSql: ['GRANT USAGE ON SCHEMA public TO datapilot_ro;', 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO datapilot_ro;'],
    datasets: [
      { name: 'public.orders', rows: 1120400, columns: 18, primaryKey: 'order_id', cursor: 'updated_at', defaultSelected: true },
      { name: 'public.customers', rows: 84210, columns: 12, primaryKey: 'customer_id', cursor: 'updated_at', defaultSelected: true },
      { name: 'public.invoices', rows: 210840, columns: 15, primaryKey: 'invoice_id', cursor: 'issued_at', defaultSelected: true },
      { name: 'public.audit_events', rows: 4820310, columns: 9, primaryKey: 'event_id', cursor: 'created_at', defaultSelected: false },
    ],
  },
  {
    sourceId: 'mysql',
    label: 'MySQL',
    connectionName: 'MySQL — Warehouse Inventory',
    hostLabel: 'Host / Endpoint',
    host: 'inv-replica.internal',
    port: '3306',
    databaseLabel: 'Database name',
    database: 'warehouse',
    usernameLabel: 'Read-only username',
    username: 'datapilot_select',
    secretLabel: 'Password',
    grantSql: ["GRANT SELECT ON warehouse.* TO 'datapilot_select'@'%';"],
    datasets: [
      { name: 'warehouse.stock_levels', rows: 142300, columns: 11, primaryKey: 'sku_id', cursor: 'updated_at', defaultSelected: true },
      { name: 'warehouse.shipments', rows: 64800, columns: 14, primaryKey: 'shipment_id', cursor: 'shipped_at', defaultSelected: true },
      { name: 'warehouse.suppliers', rows: 7200, columns: 8, primaryKey: 'supplier_id', cursor: 'updated_at', defaultSelected: false },
    ],
  },
  {
    sourceId: 's3',
    label: 'Amazon S3',
    connectionName: 'Amazon S3 — Raw Orders',
    hostLabel: 'Bucket',
    host: 's3://acme-datapilot-orders',
    port: 'us-east-1',
    databaseLabel: 'Prefix',
    database: 'exports/orders/',
    usernameLabel: 'Access key ID',
    username: 'AKIAIOSFODNN7EXAMPLE',
    secretLabel: 'Secret access key',
    grantSql: ['"Action": ["s3:GetObject", "s3:ListBucket"]', '"Resource": "arn:aws:s3:::acme-datapilot-orders/*"'],
    datasets: [
      { name: 'exports/orders/*.parquet', rows: 912400, columns: 16, primaryKey: 'order_id', cursor: 'file_modified_at', defaultSelected: true },
      { name: 'exports/returns/*.parquet', rows: 38200, columns: 10, primaryKey: 'return_id', cursor: 'file_modified_at', defaultSelected: true },
    ],
  },
  {
    sourceId: 'databricks',
    label: 'Databricks',
    connectionName: 'Databricks — Analytics Lakehouse',
    hostLabel: 'Workspace URL',
    host: 'dbc-workspace-01.cloud.databricks.com',
    port: '443',
    databaseLabel: 'Catalog',
    database: 'main.analytics',
    usernameLabel: 'Service principal',
    username: 'sp-datapilot-reader',
    secretLabel: 'Access token',
    grantSql: ['GRANT USE CATALOG ON CATALOG main TO `sp-datapilot-reader`;', 'GRANT SELECT ON SCHEMA main.analytics TO `sp-datapilot-reader`;'],
    datasets: [
      { name: 'analytics.daily_revenue', rows: 26000, columns: 7, primaryKey: 'day', cursor: 'day', defaultSelected: true },
      { name: 'analytics.customer_ltv', rows: 20000, columns: 9, primaryKey: 'customer_id', cursor: 'computed_at', defaultSelected: true },
    ],
  },
]

export const syncScheduleOptions = ['Every 15 minutes', 'Hourly', 'Daily at 02:00 UTC'] as const
export const lookbackOptions = ['Last 12 months', 'Last 24 months', 'All available history'] as const

/* ------------------------------------------------------------------ */
/* Sync history                                                        */
/* ------------------------------------------------------------------ */

export type SyncRunStatus = 'succeeded' | 'failed' | 'partial'

export type SyncRun = {
  id: string
  connectionId: string
  source: string
  status: SyncRunStatus
  /** e.g. "Failed (403)" — overrides the default label. */
  statusLabel?: string
  records: number
  durationSeconds: number
  timestamp: string
  trigger: 'Scheduled' | 'Manual'
  /** Set on runs recorded during the session (ms since epoch). */
  at?: number
}

export const syncRuns: SyncRun[] = [
  { id: 'sync_98421', connectionId: 'postgresql-production-erp', source: 'PostgreSQL — Production ERP', status: 'succeeded', records: 14820, durationSeconds: 42, timestamp: '2026-11-20T14:28:00Z', trigger: 'Scheduled' },
  { id: 'sync_98418', connectionId: 'mysql-warehouse-inventory', source: 'MySQL — Warehouse Inventory', status: 'succeeded', records: 3210, durationSeconds: 18, timestamp: '2026-11-20T14:15:00Z', trigger: 'Scheduled' },
  { id: 'sync_98415', connectionId: 'databricks-analytics-lakehouse', source: 'Databricks — Analytics Lakehouse', status: 'partial', statusLabel: 'Slow (842 ms)', records: 46000, durationSeconds: 196, timestamp: '2026-11-20T13:50:00Z', trigger: 'Scheduled' },
  { id: 'sync_98412', connectionId: 'q4-regional-sales-export', source: 'Q4 Regional Sales Export', status: 'succeeded', records: 48210, durationSeconds: 27, timestamp: '2026-11-20T11:05:00Z', trigger: 'Manual' },
  { id: 'sync_98410', connectionId: 'amazon-s3-raw-orders', source: 'Amazon S3 — Raw Orders', status: 'failed', statusLabel: 'Failed (403)', records: 0, durationSeconds: 3, timestamp: '2026-11-20T09:44:00Z', trigger: 'Scheduled' },
  { id: 'sync_98366', connectionId: 'amazon-s3-raw-orders', source: 'Amazon S3 — Raw Orders', status: 'succeeded', records: 21740, durationSeconds: 64, timestamp: '2026-11-19T22:00:00Z', trigger: 'Scheduled' },
  { id: 'sync_98302', connectionId: 'postgresql-production-erp', source: 'PostgreSQL — Production ERP', status: 'succeeded', records: 12960, durationSeconds: 39, timestamp: '2026-11-19T14:28:00Z', trigger: 'Scheduled' },
  { id: 'sync_98117', connectionId: 'mysql-warehouse-inventory', source: 'MySQL — Warehouse Inventory', status: 'failed', statusLabel: 'Failed (timeout)', records: 0, durationSeconds: 300, timestamp: '2026-11-17T03:10:00Z', trigger: 'Scheduled' },
  { id: 'sync_97950', connectionId: 'postgresql-production-erp', source: 'PostgreSQL — Production ERP', status: 'succeeded', records: 1120400, durationSeconds: 102, timestamp: '2026-11-14T09:02:00Z', trigger: 'Manual' },
]

/* ------------------------------------------------------------------ */
/* Connection health                                                   */
/* ------------------------------------------------------------------ */

export const healthKpis: Kpi[] = [
  { label: '7-day sync success rate', value: '98.6%', caption: 'Within 98.0% SLA target', captionClassName: 'text-success' },
  { label: 'Median sync latency', value: '142 ms', caption: 'Across 7 active connectors' },
]

export type SlaEntry = {
  connectionId: string
  summary: string
  /** Shown once a failing connection has been repaired in this session. */
  recoveredSummary?: string
}

export const slaEntries: SlaEntry[] = [
  { connectionId: 'postgresql-production-erp', summary: '100% uptime · 128 ms avg' },
  { connectionId: 'databricks-analytics-lakehouse', summary: '99.1% uptime · 842 ms avg' },
  { connectionId: 'amazon-s3-raw-orders', summary: 'Credential expired · 0% today', recoveredSummary: 'Credentials rotated · recovering' },
]

/* ------------------------------------------------------------------ */
/* Upload files                                                        */
/* ------------------------------------------------------------------ */

export type UploadStatus = 'uploading' | 'validating' | 'verified' | 'warnings'

export type UploadedFile = {
  id: string
  name: string
  sizeBytes: number
  rows: number
  columns: number
  warnings: number
  warningNote?: string
  status: UploadStatus
  /** 0–100 while uploading. */
  progress: number
}

export const initialUploads: UploadedFile[] = [
  { id: 'seed-1', name: 'orders_q4_2026.csv', sizeBytes: 13002342, rows: 48210, columns: 14, warnings: 0, status: 'verified', progress: 100 },
  { id: 'seed-2', name: 'inventory_nov.xlsx', sizeBytes: 3984588, rows: 14200, columns: 9, warnings: 2, warningNote: '2 date format warnings', status: 'warnings', progress: 100 },
]

export const acceptedExtensions = ['.csv', '.xlsx', '.xls', '.json'] as const
export const maxUploadBytes = 250 * 1024 * 1024
