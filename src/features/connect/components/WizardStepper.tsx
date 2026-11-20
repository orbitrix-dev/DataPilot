import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { wizardSteps } from '../data'

/** 7-step workflow bar from the "New Connection — Step 2 of 7" design. Completed steps link back. */
export function WizardStepper({ current }: { current: number }) {
  return (
    <nav aria-label="New connection progress" className="bg-light-surface border border-light-outline-variant rounded-md p-4 overflow-x-auto">
      <ol className="flex items-center gap-2 min-w-max font-label text-label-sm">
        {wizardSteps.map((step, i) => {
          const label = `${i + 1}. ${step.label}`
          const state = i < current ? 'done' : i === current ? 'current' : 'todo'
          const cls = cn(
            'px-2.5 py-1 rounded block',
            state === 'done' && 'bg-success-container text-on-success-container hover:underline',
            state === 'current' && 'bg-light-primary text-light-on-primary',
            state === 'todo' && 'bg-light-surface-container text-light-on-surface-variant',
          )
          return (
            <Fragment key={step.path}>
              {i > 0 && (
                <li aria-hidden="true" className="text-light-on-surface-variant">
                  →
                </li>
              )}
              <li aria-current={state === 'current' ? 'step' : undefined}>
                {state === 'done' ? (
                  <Link to={`/connect/new/${step.path}`} className={cls}>
                    {label}
                  </Link>
                ) : (
                  <span className={cls}>{label}</span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
