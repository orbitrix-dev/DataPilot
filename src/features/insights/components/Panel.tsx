import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'

/** Bordered surface with a title row, used for the Insights tables and charts. */
export function Panel({
  title,
  aside,
  children,
  flush = false,
  className,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  /** Flush panels hold tables (no body padding, header has its own). */
  flush?: boolean
  className?: string
}) {
  if (flush) {
    return (
      <section className={cn('bg-light-surface border border-light-outline-variant rounded-md overflow-hidden font-body text-body-md text-light-on-surface', className)}>
        <header className="px-5 py-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-title text-title-md text-light-on-surface">{title}</h2>
          {aside}
        </header>
        {children}
      </section>
    )
  }
  return (
    <section className={cn('bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4 font-body text-body-md text-light-on-surface', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-light-outline-variant pb-3">
        {typeof title === 'string' ? <h2 className="font-title text-title-md text-light-on-surface">{title}</h2> : title}
        {aside}
      </header>
      {children}
    </section>
  )
}
