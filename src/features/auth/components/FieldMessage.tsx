import type { ReactNode } from 'react'

/** Inline validation error under a field. Renders nothing when there is no message. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <span id={id} role="alert" className="font-body text-body-sm text-error">
      {message}
    </span>
  )
}

/** Neutral helper text under a field. */
export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="font-body text-body-sm text-light-on-surface-variant">
      {children}
    </span>
  )
}
