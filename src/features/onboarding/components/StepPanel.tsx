import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../../lib/cn'

type StepPanelProps = {
  title: string
  description: ReactNode
  /** Small pill rendered above the title (Welcome step). */
  eyebrow?: string
  /** Larger body-lg intro copy (Welcome step). */
  lead?: boolean
  /** Centered header with an icon above it (Completion step). */
  centered?: ReactNode
  children: ReactNode
}

/** Card body for one wizard step: heading + description + step content. */
export function StepPanel({ title, description, eyebrow, lead = false, centered, children }: StepPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Move focus to the new step's heading so screen readers announce the step change.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const heading = (
    <h1 ref={headingRef} tabIndex={-1} className="font-headline text-headline-lg text-light-on-surface outline-none">
      {title}
    </h1>
  )

  return (
    <section className="p-6 md:p-8 flex flex-col gap-gutter-lg">
      {centered ? (
        <div className="flex flex-col items-center text-center gap-2">
          {centered}
          {heading}
          <p className="font-body text-body-md text-light-on-surface-variant max-w-md text-pretty">{description}</p>
        </div>
      ) : (
        <div>
          {eyebrow && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-light-primary-container text-light-on-primary-container font-label text-label-sm mb-3">
              {eyebrow}
            </span>
          )}
          {heading}
          <p
            className={cn(
              'font-body text-light-on-surface-variant text-pretty',
              lead ? 'text-body-lg mt-2' : 'text-body-md mt-1',
            )}
          >
            {description}
          </p>
        </div>
      )}
      {children}
    </section>
  )
}
