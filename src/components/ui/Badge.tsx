import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'

const tones: Record<BadgeTone, string> = {
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
  info: 'bg-info-container text-on-info-container',
  neutral: 'bg-light-surface-container text-light-on-surface-variant',
  primary: 'bg-light-primary-container text-light-on-primary-container',
}

const dots: Record<BadgeTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
  neutral: 'bg-light-on-surface-variant',
  primary: 'bg-light-primary',
}

/** Status badge. Semantic tones are reserved for reliability / health / validation states. */
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-label text-label-sm tabular-nums whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  )
}
