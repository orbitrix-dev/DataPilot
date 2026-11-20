import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'

type OptionCardProps = {
  type: 'radio' | 'checkbox'
  name: string
  value: string
  checked: boolean
  onChange: () => void
  /** Layout + padding for the card, e.g. "p-4 flex items-center gap-3". */
  className?: string
  children: ReactNode
}

/** Selectable bordered card wrapping a native radio / checkbox; highlighted when checked. */
export function OptionCard({ type, name, value, checked, onChange, className, children }: OptionCardProps) {
  return (
    <label
      className={cn(
        'cursor-pointer border rounded-md',
        checked ? 'border-light-primary bg-light-primary-container/40' : 'border-light-outline-variant hover:border-light-outline',
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className={cn(
          'text-light-primary focus:ring-light-primary',
          type === 'checkbox' && 'rounded-sm border-light-outline',
        )}
      />
      {children}
    </label>
  )
}
