import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { fieldClass } from '../styles'
import { cn } from '../../../lib/cn'
import { useConnectState } from '../../connect/store'
import { actionTypeById, approverById, cadenceById, datasetById, retryById, type Step, type Workflow } from '../data'
import { conditionsText, describeMatches, matchRows, missingStages, requiresApproval, rowsFor, scopesOf } from '../evaluate'
import { AutomateHeader, StateBadge, WorkflowNotFound } from '../components/parts'
import { publishWorkflow, recordTest, renameWorkflow, useAutomateState } from '../store'
import { useDatasetTrust, type TrustStatus } from '../trust'

type TestResult = { runId: string; held: boolean; title: string; text: string }

/** Workflow builder (designed: automate_workflow_builder). */
export function BuilderPage() {
  const { workflowId = '' } = useParams()
  const { workflows, runs } = useAutomateState()
  const workflow = workflows.find((w) => w.id === workflowId)
  usePageChrome([
    { label: 'Automate', to: '/automate' },
    ...(workflow ? [{ label: workflow.id, to: `/automate/workflows/${workflow.id}` }] : []),
    { label: 'Builder' },
  ])
  if (!workflow) return <WorkflowNotFound id={workflowId} />
  return <Builder key={workflow.id} workflow={workflow} lastRunId={runs.find((r) => r.workflowId === workflow.id)?.id} />
}

function Builder({ workflow: w, lastRunId }: { workflow: Workflow; lastRunId?: string }) {
  const toast = useToast()
  const { runs: syncRuns } = useConnectState()
  const trust = useDatasetTrust(w.trigger.dataset)
  const [test, setTest] = useState<TestResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [blocked, setBlocked] = useState<string[] | null>(null)
  const blockedRef = useRef<HTMLDivElement>(null)

  const dataset = datasetById(w.trigger.dataset)
  const action = actionTypeById(w.action.type)
  const approver = approverById(w.action.approver)
  const cadence = cadenceById(w.trigger.cadence)
  const missing = missingStages(w)
  const needsApproval = requiresApproval(w)
  const scopes = scopesOf(w)

  const runTest = () => {
    if (missing.length) return showBlocked(missing)
    const now = 'Dry run'
    const steps: Step[] = []
    let result: TestResult
    if (w.trigger.trustGate && !trust.healthy) {
      steps.push({ title: 'Trust freshness gate held the run', detail: trust.detail, time: now, status: 'error', note: 'Held' })
      steps.push({ title: 'Nothing evaluated', detail: 'With the gate on, no conditions are checked and no approval is queued until Trust reports the data as healthy.', time: now, status: 'skipped', note: 'Skipped' })
      const runId = recordTest(w.id, `Dry run: held by Trust gate (${trust.label})`, steps)
      result = {
        runId,
        held: true,
        title: 'Test mode simulation: held by the Trust freshness gate',
        text: `${trust.detail} A real run would stop here: nothing would be evaluated, queued or sent.`,
      }
    } else {
      const rows = rowsFor(w.trigger.dataset, syncRuns)
      const matched = w.trigger.kind === 'schedule' ? [] : matchRows(w, rows)
      const willAct = w.trigger.kind === 'schedule' || matched.length > 0
      const scanned = dataset ? `Evaluated ${rows.length} ${rows.length === 1 ? dataset.noun[0] : dataset.noun[1]}.` : 'Scheduled run, no row conditions.'
      const matchText = w.trigger.kind === 'schedule' ? '' : ` ${describeMatches(dataset, matched, rows.length)} matched.`
      const next = !willAct
        ? 'No approval request would be queued.'
        : needsApproval
          ? `Would queue 1 approval request for ${approver?.label} before: ${action?.label.toLowerCase()}.`
          : `Would ${action?.label.toLowerCase()} straight away (pre-approved read-only alert).`
      steps.push({ title: 'Trigger evaluated', detail: `${scanned}${w.trigger.trustGate ? ' Trust gate passed.' : ''}`, time: now, status: 'ok', note: 'OK' })
      if (w.trigger.kind === 'threshold') {
        steps.push({ title: 'Conditions matched', detail: `${conditionsText(w)}.${matchText}`, time: now, status: 'ok', note: `${matched.length} rows` })
      }
      steps.push({ title: needsApproval ? 'Approval step simulated' : 'Approval not required', detail: next, time: now, status: 'skipped', note: 'Simulated' })
      steps.push({ title: 'Action not sent', detail: 'Dry run: nothing left DataPilot.', time: now, status: 'skipped', note: 'Dry run' })
      const runId = recordTest(w.id, `Dry run: ${w.trigger.kind === 'schedule' ? 'scheduled report' : describeMatches(dataset, matched)}${willAct ? '' : ', nothing queued'}`, steps)
      result = { runId, held: false, title: 'Test mode simulation (dry run, no external actions sent)', text: `${scanned}${matchText} ${next}` }
    }
    setTest(result)
  }

  const showBlocked = (stages: string[]) => {
    setBlocked(stages)
    window.setTimeout(() => blockedRef.current?.focus(), 0)
  }

  const requestPublish = () => {
    if (missing.length) return showBlocked(missing)
    setBlocked(null)
    setConfirmOpen(true)
  }

  const confirmPublish = () => {
    publishWorkflow(w.id)
    setConfirmOpen(false)
    toast(`Published “${w.name}” (v${w.version + 1}).${needsApproval ? ' Every run still needs human approval.' : ''}`)
  }

  const publishLabel = w.state === 'draft' ? 'Publish workflow' : `Publish changes (v${w.version + 1})`
  const canPublish = w.state === 'draft' || w.unpublishedChanges

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        eyebrow={
          <>
            <StateBadge state={w.state} />
            {w.unpublishedChanges && <span className="font-label text-label-sm text-warning">Unpublished changes</span>}
            <span className="font-body text-body-sm text-light-on-surface-variant">
              Permission-scoped · {action ? (needsApproval ? 'Approval mandatory' : 'Pre-approved alert') : 'Approval mandatory'}
            </span>
          </>
        }
        title={<EditableName workflow={w} />}
        actions={
          <>
            <Button variant="secondary" icon="science" onClick={runTest}>
              Test workflow
            </Button>
            {canPublish ? (
              <Button onClick={requestPublish}>{publishLabel}</Button>
            ) : (
              <span className="px-3 py-2 font-label text-label-md text-light-on-surface-variant">Published v{w.version} is up to date</span>
            )}
          </>
        }
      />

      {blocked && blocked.length > 0 && (
        <div ref={blockedRef} tabIndex={-1} role="alert" className="p-4 rounded-md bg-error-container text-on-error-container flex items-start gap-3 focus:outline-none">
          <Icon name="error" size={20} className="shrink-0 mt-0.5" />
          <div className="font-body text-body-sm">
            <p className="font-label text-label-lg">Finish setup before testing or publishing</p>
            <p className="mt-0.5">
              Still to configure:{' '}
              {blocked.map((s, i) => (
                <span key={s}>
                  {i > 0 && ', '}
                  <Link to={`/automate/workflows/${w.id}/${s}`} className="underline font-label text-label-md">
                    {s}
                  </Link>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      )}

      {test && (
        <div
          role="status"
          className={cn(
            'border rounded-md p-4 flex items-start justify-between gap-3',
            test.held ? 'bg-warning-container border-warning text-on-warning-container' : 'bg-info-container border-light-outline-variant text-on-info-container',
          )}
        >
          <div className="flex items-start gap-3">
            <Icon name={test.held ? 'gpp_maybe' : 'science'} size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-label text-label-lg">{test.title}</p>
              <p className="font-body text-body-sm mt-0.5">{test.text}</p>
              <Link to={`/automate/runs/${test.runId}`} className="inline-block mt-1 font-label text-label-md underline">
                View {test.runId} trace
              </Link>
            </div>
          </div>
          <button type="button" onClick={() => setTest(null)} className="font-label text-label-sm underline shrink-0">
            Close
          </button>
        </div>
      )}

      <section aria-label="Workflow stages" className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <StageCard
          n={1}
          label="Trigger"
          icon={w.trigger.kind === 'schedule' ? 'event_repeat' : 'schedule'}
          to={`/automate/workflows/${w.id}/trigger`}
          cta="Configure trigger"
          ready={!missing.includes('trigger')}
          title={w.trigger.kind === 'schedule' ? 'Recurring schedule' : dataset ? 'Data threshold' : 'Not configured'}
        >
          {cadence ? (
            <>
              {cadence.label}
              {dataset && (
                <>
                  {' '}on <span className="font-mono text-mono-sm">{dataset.id}</span>
                </>
              )}
              .
            </>
          ) : (
            'Choose a dataset and when to evaluate it.'
          )}
        </StageCard>
        <StageCard
          n={2}
          label="Conditions"
          icon="filter_alt"
          to={`/automate/workflows/${w.id}/conditions`}
          cta="Configure conditions"
          ready={!missing.includes('conditions')}
          title={w.trigger.kind === 'schedule' ? 'Not needed' : `${w.conditions.rules.length} ${w.conditions.rules.length === 1 ? 'rule' : 'rules'} active`}
        >
          {w.trigger.kind === 'threshold' && w.conditions.rules.length === 0 ? 'Add the rules rows must satisfy.' : conditionsText(w)}
        </StageCard>
        <StageCard
          n={3}
          label="Action"
          icon={action?.icon ?? 'bolt'}
          to={`/automate/workflows/${w.id}/action`}
          cta="Configure action"
          ready={!missing.includes('action')}
          title={action?.short ?? 'Not configured'}
        >
          {action && w.action.target ? `${action.label} → ${w.action.target}.` : 'Choose the action, recipient and retry policy.'}
        </StageCard>
        <StageCard
          n={4}
          label="Approval"
          icon="verified_user"
          to={`/automate/workflows/${w.id}/action`}
          cta="Approval rules"
          ready
          highlight
          title={needsApproval ? 'Human sign-off' : 'Not required'}
        >
          {needsApproval ? `Requires ${approver?.label} approval before anything is sent.` : 'Read-only alerts are pre-approved by policy.'}
        </StageCard>
        <StageCard
          n={5}
          label="Execution"
          icon="play_circle"
          to={lastRunId ? `/automate/runs/${lastRunId}` : '/automate/history'}
          cta="View logs"
          ready
          title="Audited run"
        >
          {retryById(w.action.retry)?.max} {retryById(w.action.retry)?.max === 1 ? 'retry' : 'retries'} max · every step logged to the audit trail.
        </StageCard>
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-3">
        <h2 className="font-title text-title-md text-light-on-surface">What this workflow will do before activation</h2>
        <p className="font-body text-body-md text-light-on-surface-variant">
          <Summary workflow={w} />
        </p>
        {w.trigger.trustGate && !trust.healthy && <GateNotice trust={trust} />}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-3 border-t border-light-outline-variant font-mono text-mono-sm text-light-on-surface-variant">
          <span>Required role: {needsApproval ? approver?.people : 'none (pre-approved)'}</span>
          <span aria-hidden="true">·</span>
          <span>Scopes: {[...scopes.read, ...scopes.action].join(', ') || 'none yet'}</span>
        </div>
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={w.state === 'draft' ? 'Publish this workflow?' : `Publish v${w.version + 1}?`}
        description={w.name}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button size="sm" onClick={confirmPublish}>
              {publishLabel}
            </Button>
          </>
        }
      >
        <p className="font-body text-body-md text-light-on-surface">
          <Summary workflow={w} />
        </p>
        <p className="font-body text-body-sm text-light-on-surface-variant mt-3">The change is recorded in the workflow audit trail.</p>
      </Modal>
    </div>
  )
}

function GateNotice({ trust }: { trust: TrustStatus }) {
  return (
    <div className="p-3.5 rounded bg-warning-container text-on-warning-container flex items-start gap-2.5 font-body text-body-sm">
      <Icon name="gpp_maybe" size={18} className="shrink-0 mt-0.5" />
      <p>
        The Trust gate is holding this workflow right now: {trust.detail}{' '}
        {trust.to && (
          <Link to={trust.to} className="font-label text-label-md underline">
            Open in Trust
          </Link>
        )}
      </p>
    </div>
  )
}

/** Plain-language description of what the workflow will do. */
function Summary({ workflow: w }: { workflow: Workflow }) {
  const dataset = datasetById(w.trigger.dataset)
  const action = actionTypeById(w.action.type)
  const approver = approverById(w.action.approver)
  const cadence = cadenceById(w.trigger.cadence)
  if (!cadence || !action || (w.trigger.kind === 'threshold' && !dataset)) {
    return <>Configure the trigger and action to see a summary of what this workflow will do.</>
  }
  const when = cadence.id === 'after-sync' ? `After each sync of ${dataset?.id}` : cadence.label
  return (
    <>
      {when}, DataPilot will{' '}
      {dataset ? (
        <>
          read <span className="font-mono text-mono-sm text-light-on-surface">{dataset.id}</span> (read-only)
        </>
      ) : (
        <>
          build the report from <span className="font-mono text-mono-sm text-light-on-surface">public.orders</span> (read-only)
        </>
      )}
      .{' '}
      {w.trigger.kind === 'threshold' && (
        <>
          If any {dataset?.noun[0]} matches <span className="font-mono text-mono-sm text-light-on-surface">{conditionsText(w)}</span>
          {w.trigger.trustGate && ' and Trust reports the data as healthy'},{' '}
        </>
      )}
      {w.trigger.kind === 'schedule' && w.trigger.trustGate && 'If Trust reports the data as healthy, '}
      {requiresApproval(w) ? (
        <>
          it will create a <strong className="text-light-on-surface">pending approval</strong> item for {approver?.label}.{' '}
          <strong className="text-light-on-surface">Nothing is sent</strong> until a human approves it.
        </>
      ) : (
        <>it will {action.label.toLowerCase()} straight away. Read-only alerts are pre-approved by policy.</>
      )}
    </>
  )
}

function StageCard({
  n,
  label,
  icon,
  to,
  cta,
  title,
  ready,
  highlight,
  children,
}: {
  n: number
  label: string
  icon: string
  to: string
  cta: string
  title: string
  ready: boolean
  highlight?: boolean
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className={cn(
        'bg-light-surface border rounded-md p-4 flex flex-col gap-2 transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary',
        !ready ? 'border-dashed border-light-outline' : highlight ? 'border-light-primary' : 'border-light-outline-variant hover:border-light-primary',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-label text-label-sm uppercase text-light-primary">
          {n}. {label}
        </span>
        <Icon name={ready ? icon : 'radio_button_unchecked'} size={18} className={ready ? 'text-light-primary' : 'text-light-on-surface-variant'} />
      </div>
      <p className="font-title text-title-md text-light-on-surface">{title}</p>
      <p className="font-body text-body-sm text-light-on-surface-variant break-words">{children}</p>
      <span className="font-label text-label-sm text-light-primary mt-auto pt-2">{ready ? `${cta} →` : 'Needs setup →'}</span>
    </Link>
  )
}

function EditableName({ workflow: w }: { workflow: Workflow }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(w.name)
  const [error, setError] = useState('')

  const save = (e: FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) return setError('Enter a workflow name.')
    if (v !== w.name) renameWorkflow(w.id, v)
    setEditing(false)
    setError('')
  }

  if (!editing) {
    return (
      <h1 className="font-headline text-headline-md text-light-on-surface inline-flex items-center gap-2">
        <span>{w.name}</span>
        <button
          type="button"
          onClick={() => {
            setName(w.name)
            setEditing(true)
          }}
          aria-label="Rename workflow"
          className="p-1 rounded text-light-on-surface-variant hover:bg-light-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary"
        >
          <Icon name="edit" size={18} />
        </button>
      </h1>
    )
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-1 font-body">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="wf-name" className="sr-only">
          Workflow name
        </label>
        <input
          id="wf-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          aria-invalid={!!error}
          aria-describedby={error ? 'wf-name-error' : undefined}
          className={cn(fieldClass, 'max-w-xl text-title-md', error ? 'border-error' : 'border-light-outline')}
        />
        <Button type="submit" size="sm">
          Save name
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p id="wf-name-error" role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </form>
  )
}
