import { cn } from '../../lib/cn'

export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary'
export const linkClass = cn('font-label text-label-md text-light-primary hover:underline rounded-sm', focusRing)
export const dangerLinkClass = cn('font-label text-label-md text-error hover:underline rounded-sm disabled:opacity-50 disabled:no-underline', focusRing)
export const fieldClass =
  'w-full rounded border bg-light-surface font-body text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary disabled:bg-light-surface-container-low disabled:text-light-on-surface-variant'
export const labelClass = 'block font-label text-label-md text-light-on-surface mb-1.5'
export const thClass = 'px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant'
export const panelClass = 'bg-light-surface border border-light-outline-variant rounded-md'
