export function SystemStates({ onResetFilters, onRetry }: { onResetFilters: () => void; onRetry: () => void }) {
  return (
    <section aria-label="System States Reference" className="grid grid-cols-1 md:grid-cols-3 gap-gutter-md">
      {/* Empty State */}
      <article className="bg-light-surface border border-dashed border-light-outline rounded-md p-6 flex flex-col items-center justify-center text-center gap-gutter-sm">
        <div className="w-10 h-10 rounded-full bg-light-surface-container flex items-center justify-center text-light-on-surface-variant">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            inbox
          </span>
        </div>
        <h3 className="font-title text-title-md text-light-on-surface">Empty state</h3>
        <p className="font-body text-body-sm text-light-on-surface-variant">No items match your active filters.</p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-1 px-3 py-1.5 rounded border border-light-outline text-light-on-surface hover:bg-light-surface-container font-label text-label-md"
        >
          Reset filters
        </button>
      </article>

      {/* Error State */}
      <article role="alert" className="bg-light-surface border border-error rounded-md p-6 flex flex-col justify-between gap-gutter-sm">
        <div className="flex items-start gap-3">
          <span className="w-8 h-8 rounded bg-error-container text-on-error-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              error
            </span>
          </span>
          <div>
            <h3 className="font-title text-title-md text-light-on-surface">Error state</h3>
            <p className="font-body text-body-sm text-light-on-surface-variant mt-1 text-balance">
              Telemetry endpoint returned HTTP <span className="tabular-nums">504</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <button type="button" onClick={onRetry} className="px-3 py-1.5 rounded bg-error text-on-error font-label text-label-md">
            Retry sync
          </button>
          <button type="button" className="px-3 py-1.5 rounded border border-light-outline text-light-on-surface font-label text-label-md">
            Inspect logs
          </button>
        </div>
      </article>

      {/* Loading Skeleton */}
      <div
        aria-busy="true"
        aria-label="Loading skeleton example"
        className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col justify-between gap-gutter-md"
      >
        <div className="flex items-center justify-between">
          <span className="font-label text-label-md text-light-on-surface-variant">Loading skeleton</span>
          <span className="px-2 py-0.5 rounded-sm bg-light-on-surface text-light-surface font-body text-body-sm">Tooltip</span>
        </div>
        <div className="flex flex-col gap-2.5 animate-pulse">
          <div className="h-6 w-2/3 rounded-sm bg-light-surface-container-high" />
          <div className="h-3.5 w-full rounded-sm bg-light-surface-container" />
          <div className="h-3.5 w-4/5 rounded-sm bg-light-surface-container" />
        </div>
      </div>
    </section>
  )
}
