import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import type { Kpi } from '../data'

/**
 * Metric card. With an icon it renders the Overview layout (label + icon header);
 * without, the compact Health layout (label, value, caption).
 */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  if (kpi.icon) {
    return (
      <article className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-gutter-sm">
        <header className="flex items-center justify-between">
          <span className="font-label text-label-md text-light-on-surface-variant">{kpi.label}</span>
          <Icon name={kpi.icon} size={18} className={kpi.iconClassName ?? 'text-light-on-surface-variant'} />
        </header>
        <p className={cn('font-headline text-headline-lg tabular-nums', kpi.valueClassName ?? 'text-light-on-surface')}>
          {kpi.value}
        </p>
        <span className={cn('font-body text-body-sm', kpi.captionClassName ?? 'text-light-on-surface-variant')}>
          {kpi.caption}
        </span>
      </article>
    )
  }
  return (
    <article className="bg-light-surface border border-light-outline-variant rounded-md p-5">
      <span className="font-label text-label-md text-light-on-surface-variant">{kpi.label}</span>
      <p className={cn('font-headline text-headline-lg mt-1 tabular-nums', kpi.valueClassName ?? 'text-light-on-surface')}>
        {kpi.value}
      </p>
      <span className={cn('font-body text-body-sm', kpi.captionClassName ?? 'text-light-on-surface-variant')}>
        {kpi.caption}
      </span>
    </article>
  )
}
