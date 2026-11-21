import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { describedBy, fieldClass } from '../styles'
import { cn } from '../../../lib/cn'
import { cadences, datasetById, datasets, type Trigger, type TriggerKind, type Workflow } from '../data'
import { ButtonLink, WarningNote } from '../components/parts'
import { Field, StepLayout, WorkflowStep } from '../components/StepLayout'
import { saveTrigger } from '../store'
import { useDatasetTrust } from '../trust'

/** Trigger configuration (designed: automate_trigger_configuration). */
export function TriggerPage() {
  return <WorkflowStep step="trigger">{(w) => <TriggerForm key={w.id} workflow={w} />}</WorkflowStep>
}

const kinds: { id: TriggerKind; label: string; text: string }[] = [
  { id: 'threshold', label: 'Data threshold / event', text: 'Evaluate when a dataset updates or crosses a threshold.' },
  { id: 'schedule', label: 'Recurring schedule', text: 'Run on a fixed daily or weekly cadence, e.g. report delivery.' },
]

function TriggerForm({ workflow: w }: { workflow: Workflow }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Trigger>(w.trigger)
  const [errors, setErrors] = useState<{ dataset?: string; cadence?: string }>({})
  const datasetRef = useRef<HTMLSelectElement>(null)
  const cadenceRef = useRef<HTMLSelectElement>(null)
  const trust = useDatasetTrust(draft.kind === 'threshold' ? draft.dataset : '')

  const cadenceOptions = cadences.filter((c) => draft.kind === 'threshold' || c.id !== 'after-sync')
  const dataset = datasetById(draft.dataset)
  const clearsRules = draft.kind === 'threshold' && w.conditions.rules.length > 0 && draft.dataset !== w.trigger.dataset

  const setKind = (kind: TriggerKind) =>
    setDraft((d) => ({
      ...d,
      kind,
      dataset: kind === 'schedule' ? '' : d.dataset || w.trigger.dataset,
      cadence: kind === 'schedule' && d.cadence === 'after-sync' ? '' : d.cadence,
    }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (draft.kind === 'threshold' && !draft.dataset) next.dataset = 'Choose the dataset this workflow reads.'
    if (!draft.cadence) next.cadence = 'Choose when the workflow is evaluated.'
    setErrors(next)
    if (next.dataset) return datasetRef.current?.focus()
    if (next.cadence) return cadenceRef.current?.focus()
    saveTrigger(w.id, draft)
    navigate(`/automate/workflows/${w.id}/${draft.kind === 'schedule' ? 'action' : 'conditions'}`)
  }

  return (
    <StepLayout
      workflow={w}
      step="trigger"
      title="Configure workflow trigger"
      description="Choose when this workflow evaluates your authorized datasets."
      onSubmit={submit}
      footer={
        <>
          <ButtonLink to={`/automate/workflows/${w.id}/builder`}>Cancel</ButtonLink>
          <Button type="submit">Save &amp; configure {draft.kind === 'schedule' ? 'action' : 'conditions'} →</Button>
        </>
      }
    >
      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <legend className="sr-only">Trigger type</legend>
        {kinds.map((k) => {
          const on = draft.kind === k.id
          return (
            <label
              key={k.id}
              className={cn(
                'p-4 rounded flex items-start gap-3 cursor-pointer focus-within:ring-2 focus-within:ring-light-primary',
                on ? 'border-2 border-light-primary bg-light-primary-container' : 'border border-light-outline-variant bg-light-surface hover:bg-light-surface-container-low',
              )}
            >
              <input
                type="radio"
                name="trigger-kind"
                checked={on}
                onChange={() => setKind(k.id)}
                className="mt-1 text-light-primary focus:ring-light-primary"
              />
              <span>
                <span className={cn('block font-label text-label-lg', on ? 'text-light-on-primary-container' : 'text-light-on-surface')}>{k.label}</span>
                <span className={cn('block font-body text-body-sm mt-0.5', on ? 'text-light-on-primary-container' : 'text-light-on-surface-variant')}>{k.text}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {draft.kind === 'threshold' ? (
          <Field
            id="trigger-dataset"
            label="Authorized dataset"
            error={errors.dataset}
            hint={dataset ? `Read-only access via ${dataset.source}.` : undefined}
          >
            <select
              id="trigger-dataset"
              ref={datasetRef}
              value={draft.dataset}
              onChange={(e) => setDraft({ ...draft, dataset: e.target.value as Trigger['dataset'] })}
              aria-invalid={!!errors.dataset}
              aria-describedby={describedBy('trigger-dataset', errors.dataset, !!dataset)}
              className={cn(fieldClass, errors.dataset ? 'border-error' : 'border-light-outline')}
            >
              <option value="">Choose a dataset</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} ({d.source})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant font-body text-body-sm text-light-on-surface-variant">
            Recurring schedules have no row conditions: the action runs at each scheduled time, after approval.
          </div>
        )}
        <Field id="trigger-cadence" label="Evaluation cadence (UTC)" error={errors.cadence}>
          <select
            id="trigger-cadence"
            ref={cadenceRef}
            value={draft.cadence}
            onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Trigger['cadence'] })}
            aria-invalid={!!errors.cadence}
            aria-describedby={describedBy('trigger-cadence', errors.cadence)}
            className={cn(fieldClass, errors.cadence ? 'border-error' : 'border-light-outline')}
          >
            <option value="">Choose a cadence</option>
            {cadenceOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {clearsRules && (
        <WarningNote>
          Changing the dataset clears the {w.conditions.rules.length} existing {w.conditions.rules.length === 1 ? 'condition' : 'conditions'}, because they use fields from{' '}
          <span className="font-mono text-mono-sm">{w.trigger.dataset}</span>.
        </WarningNote>
      )}

      <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex items-start gap-3">
        <input
          id="trust-gate"
          type="checkbox"
          checked={draft.trustGate}
          onChange={(e) => setDraft({ ...draft, trustGate: e.target.checked })}
          aria-describedby="trust-gate-hint"
          className="mt-1 rounded text-light-primary focus:ring-light-primary"
        />
        <div className="flex-1">
          <label htmlFor="trust-gate" className="font-label text-label-md text-light-on-surface cursor-pointer">
            Require DataPilot Trust freshness gate (recommended)
          </label>
          <p id="trust-gate-hint" className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
            Hold evaluation if the source dataset has an active Trust incident or is more than 2 hours stale.
          </p>
          {draft.kind === 'threshold' && dataset && (
            <p className={cn('font-body text-body-sm mt-2', trust.healthy ? 'text-success' : 'text-on-warning-container')}>
              {trust.healthy ? (
                <>Currently passing: {dataset.id} is healthy.</>
              ) : (
                <>
                  {draft.trustGate ? 'Currently holding' : 'Would hold'}: {trust.detail}{' '}
                  {trust.to && (
                    <Link to={trust.to} className="font-label text-label-md underline">
                      Open in Trust
                    </Link>
                  )}
                </>
              )}
            </p>
          )}
          {!draft.trustGate && draft.kind === 'threshold' && (
            <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
              With the gate off, requests are still queued when data has a Trust issue, and approvers see a warning.
            </p>
          )}
        </div>
      </div>
    </StepLayout>
  )
}
