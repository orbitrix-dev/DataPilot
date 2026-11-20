import { chartBars } from '../data'

export function ValidationChart() {
  return (
    <article className="lg:col-span-8 bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-gutter-md">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-light-outline-variant pb-4">
        <div>
          <h2 className="font-title text-title-lg text-light-on-surface">Chart — Validation volume &amp; SLA trend</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant">Daily verified records vs. warning thresholds</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-label text-label-sm text-light-on-surface-variant">
            <span className="w-2.5 h-2.5 rounded-sm bg-light-primary" /> Verified
          </span>
          <span className="inline-flex items-center gap-1.5 font-label text-label-sm text-light-on-surface-variant">
            <span className="w-2.5 h-2.5 rounded-sm bg-warning" /> Degraded
          </span>
        </div>
      </header>

      <div className="h-52 flex items-end gap-3 pt-4 px-2" role="img" aria-label="Daily validation volume, Monday to Sunday">
        {chartBars.map((bar) => (
          <div key={bar.day} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
            <div
              className={`w-full rounded-sm relative ${bar.degraded ? 'bg-warning-container' : 'bg-light-primary-container'}`}
              style={{ height: `${bar.total}%` }}
            >
              <div className="absolute bottom-0 inset-x-0 bg-light-primary rounded-sm" style={{ height: `${bar.verified}%` }} />
            </div>
            <span className="font-label text-label-sm text-light-on-surface-variant tabular-nums">{bar.day}</span>
          </div>
        ))}
      </div>
    </article>
  )
}
