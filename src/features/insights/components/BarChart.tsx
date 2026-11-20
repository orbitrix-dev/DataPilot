import { cn } from '../../../lib/cn'

export type Bar = { label: string; value: number; display: string; detail?: string }

/**
 * Vertical bar chart in the style of the Stitch Insights charts (primary bars,
 * label-sm axis labels). Values show on hover and are always available to screen readers.
 */
export function BarChart({
  bars,
  max,
  label,
  reference,
  gapClass = 'gap-4',
}: {
  bars: Bar[]
  /** Value drawn at 100% height. */
  max: number
  label: string
  /** Optional dashed reference line, e.g. a prior-period average. */
  reference?: { value: number; label: string }
  gapClass?: string
}) {
  return (
    <figure className="flex flex-col gap-2 pt-4">
      {/* Plot area: bars and the reference line share the same box, so percentages line up. */}
      <div className="relative h-36">
        <ul className={cn('absolute inset-0 flex items-end', gapClass)} aria-label={label}>
          {bars.map((b) => (
            <li key={b.label} className="group relative flex-1 h-full flex items-end">
              <div
                className="w-full bg-light-primary rounded-sm"
                style={{ height: `${(b.value / max) * 100}%` }}
                title={`${b.label}: ${b.display}${b.detail ? ` · ${b.detail}` : ''}`}
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-0 text-center font-label text-label-sm text-light-on-primary tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-state-change"
                style={{ bottom: `calc(${(b.value / max) * 100}% - 1.5rem)` }}
              >
                {b.display}
              </span>
              <span className="sr-only">
                {b.label}: {b.display}
                {b.detail ? `, ${b.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {reference && (
          <div
            className="absolute inset-x-0 border-t-2 border-dashed border-light-on-surface-variant pointer-events-none"
            style={{ bottom: `${(reference.value / max) * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className={cn('flex', gapClass)} aria-hidden="true">
        {bars.map((b) => (
          <span key={b.label} className="flex-1 text-center font-label text-label-sm text-light-on-surface-variant">
            {b.label}
          </span>
        ))}
      </div>
      {reference && (
        <figcaption className="flex items-center gap-2 font-body text-body-sm text-light-on-surface-variant">
          <span className="w-5 border-t-2 border-dashed border-light-on-surface-variant" aria-hidden="true" />
          {reference.label}
        </figcaption>
      )}
    </figure>
  )
}
