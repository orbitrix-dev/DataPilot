import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  size = 'sm',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
  /** `sm` = table toolbar (py-1.5, body-sm, w-60); `md` = page search (py-2, body-md, w-72). */
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className="relative">
      <Icon
        name="search"
        size={18}
        className="text-light-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          'pl-9 pr-3 rounded border border-light-outline bg-light-surface text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary',
          size === 'md' ? 'py-2 text-body-md w-72 max-w-full' : 'py-1.5 text-body-sm w-60 max-w-full',
          className,
        )}
      />
    </div>
  )
}
