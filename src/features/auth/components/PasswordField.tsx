import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { FieldError, FieldHint } from './FieldMessage'
import { describedBy, inputClassName } from './fieldStyles'

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  label: string
  error?: string
  hint?: ReactNode
  /** Rendered at the right of the label row (e.g. "Forgot password?"). */
  labelAction?: ReactNode
  /** Rendered between the input and the hint (e.g. a strength meter). */
  children?: ReactNode
  /** Show the visibility toggle (default true). */
  toggle?: boolean
}

/** Password input with show/hide toggle, inline error and helper text. */
export function PasswordField({
  label,
  error,
  hint,
  labelAction,
  children,
  toggle = true,
  id,
  ...rest
}: PasswordFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const [visible, setVisible] = useState(false)

  const labelEl = (
    <label htmlFor={inputId} className="font-label text-label-md text-light-on-surface">
      {label}
    </label>
  )

  return (
    <div className="flex flex-col gap-1.5">
      {labelAction ? (
        <div className="flex items-center justify-between">
          {labelEl}
          {labelAction}
        </div>
      ) : (
        labelEl
      )}
      <div className="relative flex items-center">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && errorId, hint ? hintId : undefined)}
          className={inputClassName(Boolean(error), toggle ? 'pl-3 pr-10 py-2' : 'px-3 py-2')}
          {...rest}
        />
        {toggle && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-controls={inputId}
            aria-pressed={visible}
            className="absolute right-2.5 p-1 text-light-on-surface-variant hover:text-light-on-surface"
          >
            <Icon name={visible ? 'visibility_off' : 'visibility'} size={18} />
          </button>
        )}
      </div>
      {children}
      <FieldError id={errorId} message={error} />
      {hint && <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  )
}
