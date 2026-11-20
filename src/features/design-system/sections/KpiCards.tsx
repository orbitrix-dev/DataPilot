import { Badge } from '../../../components/ui/Badge'
import { kpis } from '../data'

export function KpiCards() {
  return (
    <section aria-label="KPI Cards" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter-md items-stretch">
      {kpis.map((kpi) => (
        <article
          key={kpi.label}
          className="h-full bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-gutter-sm"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="font-label text-label-md text-light-on-surface-variant">{kpi.label}</h2>
            <span className={`material-symbols-outlined text-[18px] ${kpi.iconClassName}`} aria-hidden="true">
              {kpi.icon}
            </span>
          </header>
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-headline text-headline-lg text-light-on-surface tabular-nums">{kpi.value}</p>
            <Badge tone={kpi.badge.tone}>{kpi.badge.label}</Badge>
          </div>
          <p className="font-body text-body-sm text-light-on-surface-variant">{kpi.caption}</p>
        </article>
      ))}
    </section>
  )
}
