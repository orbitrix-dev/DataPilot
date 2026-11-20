export type Tone = 'success' | 'warning' | 'error'

export type Kpi = {
  label: string
  icon: string
  /** Extra classes for the header icon (semantic colour). */
  iconClassName: string
  value: string
  badge: { tone: Tone; label: string }
  caption: string
}

export const kpis: Kpi[] = [
  {
    label: 'Reliability score',
    icon: 'verified_user',
    iconClassName: 'text-light-on-surface-variant',
    value: '99.84%',
    badge: { tone: 'success', label: '+0.12%' },
    caption: 'Healthy across 42 pipelines',
  },
  {
    label: 'Events validated',
    icon: 'database',
    iconClassName: 'text-light-on-surface-variant',
    value: '14.2M',
    badge: { tone: 'success', label: '+6.4%' },
    caption: 'Rolling 24-hour throughput',
  },
  {
    label: 'Schema warnings',
    icon: 'warning',
    iconClassName: 'text-warning',
    value: '3',
    badge: { tone: 'warning', label: 'Review' },
    caption: 'Non-breaking field additions',
  },
  {
    label: 'Sync failures',
    icon: 'error',
    iconClassName: 'text-error',
    value: '1',
    badge: { tone: 'error', label: 'Action needed' },
    caption: 'Endpoint timeout on EU-West',
  },
]

export type ChartBar = {
  day: string
  /** Height of the total-volume bar, as a percentage of the plot height. */
  total: number
  /** Height of the verified portion, as a percentage of the total bar. */
  verified: number
  degraded?: boolean
}

export const chartBars: ChartBar[] = [
  { day: 'Mon', total: 64, verified: 85 },
  { day: 'Tue', total: 78, verified: 90 },
  { day: 'Wed', total: 72, verified: 78, degraded: true },
  { day: 'Thu', total: 88, verified: 94 },
  { day: 'Fri', total: 92, verified: 96 },
  { day: 'Sat', total: 58, verified: 88 },
  { day: 'Sun', total: 66, verified: 92 },
]

export type TimelineEvent = {
  title: string
  actor: string
  time: string
  dotClassName: string
}

export const timelineEvents: TimelineEvent[] = [
  { title: 'Schema policy v2.4 published', actor: 'Elena Vance', time: '14:28 UTC', dotClassName: 'bg-success' },
  { title: 'Latency threshold exceeded', actor: 'EU-West Connector', time: '13:52 UTC', dotClassName: 'bg-warning' },
  { title: 'RBAC role updated for Analysts', actor: 'Marcus Chen', time: '11:10 UTC', dotClassName: 'bg-light-primary' },
  { title: 'Webhook delivery failed (504)', actor: 'System Worker', time: '09:44 UTC', dotClassName: 'bg-error' },
]

export type ResourceStatus = 'Verified' | 'Degraded' | 'Failed'

export const statusTone: Record<ResourceStatus, Tone> = {
  Verified: 'success',
  Degraded: 'warning',
  Failed: 'error',
}

export const statusFilters = ['All', 'Verified', 'Degraded', 'Failed'] as const
export type StatusFilter = (typeof statusFilters)[number]

export type Resource = {
  id: string
  category: string
  status: ResourceStatus
  latency: string
  updated: string
}

export const resources: Resource[] = [
  { id: 'dp_sys_core_01', category: 'Warehouse Connector', status: 'Verified', latency: '128 ms', updated: 'Nov 20, 14:30 UTC' },
  { id: 'dp_sys_eu_sync', category: 'CRM Ingestion', status: 'Degraded', latency: '842 ms', updated: 'Nov 20, 14:18 UTC' },
  { id: 'dp_sys_webhook_09', category: 'Automation Trigger', status: 'Failed', latency: 'Timeout', updated: 'Nov 20, 09:44 UTC' },
]

export const syncCadences = ['Every 15 minutes', 'Hourly', 'Daily at 00:00 UTC'] as const
export type SyncCadence = (typeof syncCadences)[number]

export const dateRangeLabel = 'Nov 13 – Nov 20, 2026'
