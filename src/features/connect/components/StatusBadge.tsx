import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import type { StatusTone } from '../status'

const tones: Record<StatusTone, string> = {
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
  primary: 'bg-light-primary-container text-light-on-primary-container',
  neutral: 'bg-light-surface-container border border-light-outline text-light-on-surface-variant',
}

const dots: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  primary: 'bg-light-primary',
  neutral: 'bg-light-on-surface-variant',
}

/** Stitch status chip: `px-2.5 py-0.5 rounded-sm font-label text-label-sm` with an optional leading dot. */
export function StatusBadge({
  tone,
  children,
  dot = false,
  size = 'sm',
  compact = false,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  dot?: boolean
  /** `md` matches the `py-1` header chips (e.g. "Read-only default"). */
  size?: 'sm' | 'md'
  /** `px-2` instead of `px-2.5` (marketplace availability chips). */
  compact?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm font-label text-label-sm whitespace-nowrap tabular-nums',
        compact ? 'px-2' : 'px-2.5',
        size === 'md' ? 'py-1' : 'py-0.5',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  )
}
