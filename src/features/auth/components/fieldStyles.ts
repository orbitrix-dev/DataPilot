import { cn } from '../../../lib/cn'

/** Input classes from the Stitch auth screens, with the error variant swapped in when invalid. */
export function inputClassName(invalid: boolean, extra?: string): string {
  return cn(
    'w-full rounded border bg-light-surface text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1',
    invalid
      ? 'border-error focus:border-error focus:ring-error'
      : 'border-light-outline focus:border-light-primary focus:ring-light-primary',
    extra ?? 'px-3 py-2',
  )
}

/** Build the aria-describedby value from optional ids. */
export function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(' ')
  return value || undefined
}
