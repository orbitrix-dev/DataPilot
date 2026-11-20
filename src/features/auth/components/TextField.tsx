import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { FieldError, FieldHint } from './FieldMessage'
import { describedBy, inputClassName } from './fieldStyles'

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string
  error?: string
  hint?: ReactNode
  /** Replaces the default `px-3 py-2` padding/typography extras. */
  inputClassName?: string
}

/** Labelled input with inline error + hint, styled like the Stitch auth forms. */
export function TextField({ label, error, hint, id, inputClassName: extra, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-label text-label-md text-light-on-surface">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId, hint ? hintId : undefined)}
        className={inputClassName(Boolean(error), extra)}
        {...rest}
      />
      <FieldError id={errorId} message={error} />
      {hint && <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  )
}
