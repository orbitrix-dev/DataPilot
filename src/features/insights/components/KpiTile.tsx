import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import type { StatusTone } from '../../connect/status'

export type Kpi = {
  label: string
  value: string
  valueClass?: string
  caption?: ReactNode
  captionClass?: string
  badge?: { tone: StatusTone; label: string }
  to?: string
  /** Warning outline, used when a Trust issue affects the figure. */
  flagged?: boolean
  /** `md` uses headline-md (the five receivables aging tiles). */
  size?: 'lg' | 'md'
}

/** Insights KPI card. Linked cards get the design's hover outline. */
export function KpiTile({ kpi }: { kpi: Kpi }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-label text-label-md text-light-on-surface-variant">{kpi.label}</span>
        {kpi.badge && (
          <StatusBadge tone={kpi.badge.tone} compact className="shrink-0">
            {kpi.badge.label}
          </StatusBadge>
        )}
      </div>
      <p
        className={cn(
          'font-headline tabular-nums',
          kpi.size === 'md' ? 'text-headline-md' : 'text-headline-lg',
          kpi.valueClass ?? 'text-light-on-surface',
        )}
      >
        {kpi.value}
      </p>
      {kpi.caption && (
        <span className={cn('font-body text-body-sm tabular-nums', kpi.captionClass ?? 'text-light-on-surface-variant')}>
          {kpi.caption}
        </span>
      )}
    </>
  )
  const base = cn(
    'bg-light-surface border rounded-md p-5 flex flex-col justify-between gap-2',
    kpi.flagged ? 'border-warning' : 'border-light-outline-variant',
  )
  if (!kpi.to) return <article className={base}>{body}</article>
  return (
    <Link
      to={kpi.to}
      className={cn(
        base,
        !kpi.flagged && 'hover:border-light-primary',
        'transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
      )}
    >
      {body}
    </Link>
  )
}
