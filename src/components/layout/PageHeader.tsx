import type { ReactNode } from 'react'

/** Page title + description on the left, actions on the right (stacks on mobile). */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-gutter-md">
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">{title}</h1>
        {description && <p className="font-body text-body-md text-light-on-surface-variant mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-gutter-sm">{actions}</div>}
    </section>
  )
}
