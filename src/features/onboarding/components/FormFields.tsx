import { useId, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cn } from '../../../lib/cn'

const controlClass =
  'w-full px-3 py-2 rounded border border-light-outline bg-light-surface text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary'

const labelClass = 'font-label text-label-md text-light-on-surface'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }

export function TextField({ label, error, className, ...rest }: TextFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(controlClass, error && 'border-error', className)}
        {...rest}
      />
      {error && (
        <span id={errorId} role="alert" className="font-body text-body-sm text-error">
          {error}
        </span>
      )}
    </div>
  )
}

type SelectFieldProps<T extends string> = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}

export function SelectField<T extends string>({ label, value, options, onChange, className, ...rest }: SelectFieldProps<T>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(options.find((o) => o === e.target.value) ?? value)}
        className={cn(controlClass, className)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}
