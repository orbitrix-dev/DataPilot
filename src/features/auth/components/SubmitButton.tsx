import type { ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'

type SubmitButtonProps = {
  loading: boolean
  loadingLabel: string
  children: ReactNode
  trailingIcon?: string
  /** Disable without showing the spinner (e.g. while another action is pending). */
  disabled?: boolean
  className?: string
}

/** Full-width primary submit button with a spinner while the request is pending. */
export function SubmitButton({ loading, loadingLabel, children, trailingIcon, disabled, className }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      aria-busy={loading}
      className={cn(
        'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary transition-colors duration-state-change',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1',
        'disabled:opacity-70 disabled:cursor-wait',
        className,
      )}
    >
      {loading && <Icon name="progress_activity" size={18} className="animate-spin" />}
      <span className="font-label text-label-lg">{loading ? loadingLabel : children}</span>
      {!loading && trailingIcon && <Icon name={trailingIcon} size={18} />}
    </button>
  )
}
