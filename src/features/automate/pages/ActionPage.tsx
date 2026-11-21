import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { describedBy, fieldClass } from '../styles'
import { cn } from '../../../lib/cn'
import { actionTypeById, actionTypes, approvers, retryPolicies, type Action, type Workflow } from '../data'
import { scopesOf } from '../evaluate'
import { ButtonLink } from '../components/parts'
import { Field, StepLayout, WorkflowStep } from '../components/StepLayout'
import { saveAction } from '../store'

/** Action configuration (designed: automate_action_configuration). */
export function ActionPage() {
  return <WorkflowStep step="action">{(w) => <ActionForm key={w.id} workflow={w} />}</WorkflowStep>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function targetIssue(action: Action): string | undefined {
  const type = actionTypeById(action.type)
  if (!type) return undefined
  const v = action.target.trim()
  if (!v) return `Enter the ${type.targetLabel.toLowerCase()}.`
  if (type.targetKind === 'email' && !EMAIL.test(v)) return 'Enter a valid email address, e.g. owner@acme.io.'
  if (type.targetKind === 'channel' && !/^#[a-z0-9][a-z0-9_-]*$/.test(v)) return 'Enter a Slack channel starting with #, e.g. #purchasing-ops.'
  return undefined
}

function ActionForm({ workflow: w }: { workflow: Workflow }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [draft, setDraft] = useState<Action>(w.action)
  const [errors, setErrors] = useState<{ type?: string; target?: string }>({})
  const typeRef = useRef<HTMLSelectElement>(null)
  const targetRef = useRef<HTMLInputElement>(null)

  const type = actionTypeById(draft.type)
  const scopes = scopesOf({ ...w, action: draft })
  const back = w.trigger.kind === 'schedule' ? 'trigger' : 'conditions'

  const changeType = (id: string) => {
    const next = actionTypeById(id)
    // Swap in the new action's default target unless the user typed their own.
    const keepTarget = draft.target && draft.target !== type?.targetPlaceholder
    setDraft({ ...draft, type: (next?.id ?? '') as Action['type'], target: keepTarget ? draft.target : (next?.targetPlaceholder ?? '') })
    setErrors({})
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = { type: type ? undefined : 'Choose the action this workflow performs.', target: targetIssue(draft) }
    setErrors(next)
    if (next.type) return typeRef.current?.focus()
    if (next.target) return targetRef.current?.focus()
    saveAction(w.id, { ...draft, target: draft.target.trim() })
    toast('Action saved. Test the workflow before publishing.', 'info')
    navigate(`/automate/workflows/${w.id}/builder`)
  }

  return (
    <StepLayout
      workflow={w}
      step="action"
      title="Configure controlled action"
      description="Specify the exact action, required permission scope, and retry behavior."
      onSubmit={submit}
      footer={
        <>
          <ButtonLink to={`/automate/workflows/${w.id}/${back}`}>Back</ButtonLink>
          <Button type="submit">Save action &amp; return to builder</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field id="action-type" label="Action type" error={errors.type}>
          <select
            id="action-type"
            ref={typeRef}
            value={draft.type}
            onChange={(e) => changeType(e.target.value)}
            aria-invalid={!!errors.type}
            aria-describedby={describedBy('action-type', errors.type)}
            className={cn(fieldClass, errors.type ? 'border-error' : 'border-light-outline')}
          >
            <option value="">Choose an action</option>
            {actionTypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="action-target" label={type?.targetLabel ?? 'Recipient / target'} error={errors.target}>
          <input
            id="action-target"
            ref={targetRef}
            value={draft.target}
            disabled={!type}
            onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            placeholder={type?.targetPlaceholder ?? 'Choose an action first'}
            type={type?.targetKind === 'email' ? 'email' : 'text'}
            aria-invalid={!!errors.target}
            aria-describedby={describedBy('action-target', errors.target)}
            className={cn(fieldClass, 'disabled:bg-light-surface-container-low', errors.target ? 'border-error' : 'border-light-outline')}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          id="action-approver"
          label="Required approver role"
          hint={type?.preApproved ? 'Not required: read-only alerts are pre-approved by policy.' : 'Nothing runs until someone in this role approves it.'}
        >
          <select
            id="action-approver"
            value={draft.approver}
            disabled={type?.preApproved}
            onChange={(e) => setDraft({ ...draft, approver: e.target.value as Action['approver'] })}
            aria-describedby="action-approver-hint"
            className={cn(fieldClass, 'border-light-outline disabled:bg-light-surface-container-low disabled:text-light-on-surface-variant')}
          >
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="action-retry" label="Failure & retry policy">
          <select
            id="action-retry"
            value={draft.retry}
            onChange={(e) => setDraft({ ...draft, retry: e.target.value as Action['retry'] })}
            className={cn(fieldClass, 'border-light-outline')}
          >
            {retryPolicies.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant" aria-live="polite">
        <p className="font-label text-label-sm uppercase text-light-on-surface-variant">Permission scope &amp; preview</p>
        <p className="font-body text-body-sm text-light-on-surface mt-1">
          {type ? (
            <>
              Grants{' '}
              {scopes.action.map((s, i) => (
                <span key={s}>
                  {i > 0 && ' and '}
                  <span className="font-mono text-mono-sm">{s}</span>
                </span>
              ))}{' '}
              only for this workflow, plus read access to{' '}
              <span className="font-mono text-mono-sm">{scopes.read.join(', ') || 'no datasets'}</span>. {type.limits}
            </>
          ) : (
            'Choose an action to see exactly which permissions this workflow gets.'
          )}
        </p>
      </div>
    </StepLayout>
  )
}
