import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import type { Workflow } from '../data'
import { useAutomateState } from '../store'
import { WorkflowNotFound } from './parts'

export type StepId = 'trigger' | 'conditions' | 'action'

const steps: { id: StepId; label: string }[] = [
  { id: 'trigger', label: 'Trigger' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'action', label: 'Action' },
]

/** Loads the workflow from the URL and renders the step page, or a not-found card. */
export function WorkflowStep({ step, children }: { step: StepId; children: (w: Workflow) => ReactNode }) {
  const { workflowId = '' } = useParams()
  const { workflows } = useAutomateState()
  const workflow = workflows.find((w) => w.id === workflowId)
  const label = steps.find((s) => s.id === step)!.label
  usePageChrome([
    { label: 'Automate', to: '/automate' },
    ...(workflow ? [{ label: workflow.id, to: `/automate/workflows/${workflow.id}/builder` }] : []),
    { label },
  ])
  if (!workflow) return <WorkflowNotFound id={workflowId} />
  return <>{children(workflow)}</>
}

/** Page frame for the trigger / conditions / action forms (designed at max-w-4xl). */
export function StepLayout({
  workflow,
  step,
  title,
  description,
  onSubmit,
  footer,
  children,
}: {
  workflow: Workflow
  step: StepId
  title: string
  description: string
  onSubmit: (e: FormEvent) => void
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <div className="max-w-4xl w-full mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <ol className="flex flex-wrap items-center gap-2 font-label text-label-md" aria-label="Workflow setup steps">
          {steps.map((s, i) => {
            const done = workflow.configured[s.id]
            const current = s.id === step
            const skipped = s.id === 'conditions' && workflow.trigger.kind === 'schedule'
            return (
              <li key={s.id} className="flex items-center gap-2">
                {i > 0 && <Icon name="chevron_right" size={16} className="text-light-on-surface-variant" />}
                <Link
                  to={`/automate/workflows/${workflow.id}/${s.id}`}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
                    current ? 'bg-light-primary-container text-light-on-primary-container' : 'text-light-on-surface-variant hover:bg-light-surface-container',
                  )}
                >
                  <Icon name={done || skipped ? 'check_circle' : 'radio_button_unchecked'} size={16} className={done && !current ? 'text-success' : undefined} />
                  {s.label}
                  {skipped && <span className="sr-only">(not needed for schedules)</span>}
                </Link>
              </li>
            )
          })}
        </ol>
        <div>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            <span className="font-mono text-mono-sm">{workflow.id}</span> · {workflow.name}
          </p>
          <h1 className="font-headline text-headline-md text-light-on-surface">{title}</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-0.5">{description}</p>
        </div>
      </div>
      <form noValidate onSubmit={onSubmit} className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-5">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-light-outline-variant">{footer}</div>
      </form>
    </div>
  )
}

/** Label + control + error/hint, with ids wired for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-label text-label-md text-light-on-surface">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="font-body text-body-sm text-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="font-body text-body-sm text-light-on-surface-variant">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

