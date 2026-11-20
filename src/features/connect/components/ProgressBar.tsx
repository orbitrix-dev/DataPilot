import { cn } from '../../../lib/cn'

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('w-full rounded-full bg-light-surface-container overflow-hidden', className ?? 'h-2.5')}
    >
      <div
        className="h-full bg-light-primary rounded-full transition-[width] duration-state-change ease-state-change"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
