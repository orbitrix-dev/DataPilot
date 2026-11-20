import { Button } from '../../../components/ui/Button'
import { dateRangeLabel } from '../data'

export function PageIntro({ onOpenSidePanel, onConfirm }: { onOpenSidePanel: () => void; onConfirm: () => void }) {
  return (
    <section className="flex flex-col md:flex-row md:items-center justify-between gap-gutter-md">
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Foundational UI System</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          Reusable application shell, navigation architecture, and core enterprise components for DataPilot.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-gutter-sm">
        {/* Date Range Selector */}
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container-low transition-colors duration-state-change"
        >
          <span className="material-symbols-outlined text-[18px] text-light-on-surface-variant" aria-hidden="true">
            calendar_today
          </span>
          <span className="font-label text-label-md tabular-nums">{dateRangeLabel}</span>
          <span className="material-symbols-outlined text-[16px] text-light-on-surface-variant" aria-hidden="true">
            expand_more
          </span>
        </button>
        {/* Side Panel Trigger */}
        <button
          type="button"
          onClick={onOpenSidePanel}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container transition-colors duration-state-change"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            dock_to_left
          </span>
          <span className="font-label text-label-lg">Open side panel</span>
        </button>
        {/* Confirmation Dialog Trigger */}
        <Button icon="add" onClick={onConfirm}>
          Confirm action
        </Button>
      </div>
    </section>
  )
}
