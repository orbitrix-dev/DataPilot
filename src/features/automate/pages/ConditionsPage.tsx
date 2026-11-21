import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { fieldClass } from '../styles'
import { cn } from '../../../lib/cn'
import { useConnectState } from '../../connect/store'
import { datasetById, ops, type Conditions, type Op, type Rule, type Workflow } from '../data'
import { describeMatches, matchRows, ruleIssue, rowsFor } from '../evaluate'
import { ButtonLink } from '../components/parts'
import { StepLayout, WorkflowStep } from '../components/StepLayout'
import { saveConditions } from '../store'
import { useDatasetTrust } from '../trust'

const MAX_RULES = 5

/** Filter conditions (designed: automate_condition_configuration). */
export function ConditionsPage() {
  return <WorkflowStep step="conditions">{(w) => <ConditionsForm key={w.id} workflow={w} />}</WorkflowStep>
}

function ConditionsForm({ workflow: w }: { workflow: Workflow }) {
  const navigate = useNavigate()
  const { runs: syncRuns } = useConnectState()
  const dataset = datasetById(w.trigger.dataset)
  const trust = useDatasetTrust(w.trigger.dataset)
  const [draft, setDraft] = useState<Conditions>(w.conditions)
  const [submitted, setSubmitted] = useState(false)

  if (w.trigger.kind === 'schedule' || !dataset) {
    const schedule = w.trigger.kind === 'schedule'
    return (
      <StepLayout
        workflow={w}
        step="conditions"
        title="Configure filter conditions"
        description="Define exact rules that records must satisfy before queueing an approval request."
        onSubmit={(e) => e.preventDefault()}
        footer={
          <ButtonLink to={`/automate/workflows/${w.id}/${schedule ? 'action' : 'trigger'}`} variant="primary">
            {schedule ? 'Configure action →' : 'Choose a dataset →'}
          </ButtonLink>
        }
      >
        <p className="font-body text-body-md text-light-on-surface-variant">
          {schedule
            ? 'This workflow runs on a recurring schedule, so it has no row conditions. Each scheduled run still waits for approval.'
            : 'Choose the dataset on the trigger step first. Conditions use that dataset’s fields.'}
        </p>
      </StepLayout>
    )
  }

  const issues = draft.rules.map((r) => ruleIssue(r, dataset))
  const preview = matchRows({ ...w, conditions: draft }, rowsFor(dataset.id, syncRuns))
  const total = rowsFor(dataset.id, syncRuns).length
  const valid = draft.rules.length > 0 && issues.every((i) => !i)
  const numericFields = dataset.fields.filter((f) => f.type === 'number').map((f) => f.name)

  const update = (i: number, patch: Partial<Rule>) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const changeField = (i: number, field: string) => {
    const type = dataset.fields.find((f) => f.name === field)?.type
    update(i, type === 'text' ? { field, op: '==' } : { field })
  }

  const addRule = () => {
    const field = dataset.fields[0]
    setDraft((d) => ({ ...d, rules: [...d.rules, { field: field.name, op: field.type === 'text' ? '==' : '>', value: '' }] }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!valid) {
      const i = issues.findIndex(Boolean)
      window.setTimeout(() => document.getElementById(i >= 0 ? `rule-${i}-value` : 'add-condition')?.focus(), 0)
      return
    }
    saveConditions(w.id, { ...draft, rules: draft.rules.map((r) => ({ ...r, value: r.value.trim() })) })
    navigate(`/automate/workflows/${w.id}/action`)
  }

  return (
    <StepLayout
      workflow={w}
      step="conditions"
      title="Configure filter conditions"
      description="Define exact rules that records must satisfy before queueing an approval request."
      onSubmit={submit}
      footer={
        <>
          <ButtonLink to={`/automate/workflows/${w.id}/trigger`}>Back</ButtonLink>
          <Button type="submit">Save &amp; configure action →</Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cond-match" className="font-label text-label-md text-light-on-surface">
          Match
        </label>
        <select
          id="cond-match"
          value={draft.match}
          onChange={(e) => setDraft({ ...draft, match: e.target.value as Conditions['match'] })}
          className={cn(fieldClass, 'w-auto border-light-outline text-body-sm')}
        >
          <option value="all">ALL of the following conditions (AND)</option>
          <option value="any">ANY of the following conditions (OR)</option>
        </select>
        <span className="font-body text-body-sm text-light-on-surface-variant">
          on <span className="font-mono text-mono-sm">{dataset.id}</span>
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {draft.rules.map((rule, i) => {
          const issue = submitted ? issues[i] : undefined
          const field = dataset.fields.find((f) => f.name === rule.field)
          const n = i + 1
          return (
            <div key={i} className="p-3.5 rounded bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-2">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-start">
                <div>
                  <label htmlFor={`rule-${i}-field`} className="sr-only">
                    Condition {n} field
                  </label>
                  <select
                    id={`rule-${i}-field`}
                    value={rule.field}
                    onChange={(e) => changeField(i, e.target.value)}
                    className={cn(fieldClass, 'border-light-outline text-body-sm font-mono')}
                  >
                    {dataset.fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {dataset.id.split('.')[1]}.{f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`rule-${i}-op`} className="sr-only">
                    Condition {n} operator
                  </label>
                  <select
                    id={`rule-${i}-op`}
                    value={rule.op}
                    onChange={(e) => update(i, { op: e.target.value as Op })}
                    className={cn(fieldClass, 'border-light-outline text-body-sm')}
                  >
                    {ops
                      .filter((o) => field?.type !== 'text' || o.id === '==')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`rule-${i}-value`} className="sr-only">
                    Condition {n} value
                  </label>
                  <input
                    id={`rule-${i}-value`}
                    value={rule.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder={field?.type === 'text' ? 'Text value' : `Number or ${numericFields.filter((f) => f !== rule.field)[0] ?? 'number'}`}
                    aria-invalid={!!issue}
                    aria-describedby={issue ? `rule-${i}-error` : undefined}
                    className={cn(fieldClass, 'text-body-sm font-mono', issue ? 'border-error' : 'border-light-outline')}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))}
                  aria-label={`Remove condition ${n}`}
                  className="p-2 rounded text-light-on-surface-variant hover:bg-light-surface-container hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary justify-self-end"
                >
                  <Icon name="delete" size={18} />
                </button>
              </div>
              {issue && (
                <p id={`rule-${i}-error`} role="alert" className="font-body text-body-sm text-error">
                  {issue}
                </p>
              )}
            </div>
          )
        })}

        {draft.rules.length === 0 && (
          <p className={cn('font-body text-body-sm', submitted ? 'text-error' : 'text-light-on-surface-variant')} role={submitted ? 'alert' : undefined}>
            Add at least one condition. Without one, every row would queue an approval request.
          </p>
        )}

        <div>
          <Button id="add-condition" variant="secondary" size="sm" icon="add" onClick={addRule} disabled={draft.rules.length >= MAX_RULES}>
            Add condition
          </Button>
          {draft.rules.length >= MAX_RULES && (
            <span className="ml-3 font-body text-body-sm text-light-on-surface-variant">Up to {MAX_RULES} conditions per workflow.</span>
          )}
        </div>
      </div>

      <div
        className={cn('p-4 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2', trust.healthy ? 'bg-info-container text-on-info-container' : 'bg-warning-container text-on-warning-container')}
        aria-live="polite"
      >
        <span className="font-body text-body-sm">
          Live preview against the current <span className="font-mono text-mono-sm">{dataset.id}</span> snapshot:{' '}
          {draft.rules.length === 0 || issues.some(Boolean) ? (
            'finish the conditions to see matches.'
          ) : (
            <>
              <strong>{describeMatches(dataset, preview, total)}</strong> match.
            </>
          )}
        </span>
        <span className="font-label text-label-sm shrink-0">
          {trust.healthy ? (
            'Trust: healthy'
          ) : trust.to ? (
            <Link to={trust.to} className="underline">
              Trust: {trust.label}
            </Link>
          ) : (
            `Trust: ${trust.label}`
          )}
        </span>
      </div>
    </StepLayout>
  )
}
