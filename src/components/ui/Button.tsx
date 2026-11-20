import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-light-primary text-light-on-primary hover:bg-light-secondary',
  secondary: 'border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container',
  ghost: 'text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface',
  danger: 'bg-error text-on-error hover:bg-on-error-container',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-label-md',
  md: 'px-4 py-2 text-label-lg',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: string
  trailingIcon?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, trailingIcon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-label transition-colors duration-state-change ease-state-change',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={size === 'sm' ? 16 : 18} />}
    </button>
  )
})
