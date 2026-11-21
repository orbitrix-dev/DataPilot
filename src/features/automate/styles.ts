export const fieldClass =
  'w-full px-3 py-2 rounded border bg-light-surface font-body text-body-md text-light-on-surface focus:border-light-primary focus:ring-1 focus:ring-light-primary'

/** aria-describedby for a field with an optional error or hint (ids follow `${id}-error` / `${id}-hint`). */
export const describedBy = (id: string, error?: string, hint?: boolean) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined)
