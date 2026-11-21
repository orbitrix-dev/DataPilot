import { useSyncExternalStore } from 'react'
import {
  PEOPLE,
  seedRequests,
  seedRuns,
  seedWorkflows,
  templates,
  type Action,
  type ApprovalRequest,
  type Conditions,
  type Run,
  type Step,
  type Trigger,
  type Workflow,
} from './data'

/**
 * Session state for Automate, so building, testing, publishing, pausing,
 * approving, rejecting and retrying on one screen show up on the others.
 * Nothing is sent anywhere: "executing" an action only records a run.
 */
type AutomateState = {
  workflows: Workflow[]
  requests: ApprovalRequest[]
  runs: Run[]
}

let state: AutomateState = { workflows: seedWorkflows, requests: seedRequests, runs: seedRuns }
const listeners = new Set<() => void>()

function setState(next: AutomateState) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAutomateState(): AutomateState {
  return useSyncExternalStore(subscribe, () => state)
}

const ME = 'Elena Vance'
const ME_ROLE = PEOPLE.elena
const EXECUTE_MS = 1500

function clock(withSeconds = false): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}${withSeconds ? `:${p(d.getSeconds())}` : ''}`
}
const nowLabel = (withSeconds = false) => `Today, ${clock(withSeconds)}`

let workflowSeq = 108
let runSeq = 8842

function nextRunId() {
  runSeq += 1
  return `RUN-${runSeq}`
}

function patchWorkflow(id: string, patch: (w: Workflow) => Partial<Workflow>, audit?: string) {
  setState({
    ...state,
    workflows: state.workflows.map((w) =>
      w.id === id
        ? { ...w, ...patch(w), audit: audit ? [{ text: audit, actor: ME_ROLE, time: nowLabel(), at: Date.now() }, ...w.audit] : w.audit }
        : w,
    ),
  })
}

/* --------------------------------------------------------------- building */

/** Creates a draft from a template (or a blank one) and returns its id. */
export function createWorkflow(templateId?: string): string {
  workflowSeq += 1
  const id = `WF-${workflowSeq}`
  const t = templates.find((x) => x.id === templateId)
  const workflow: Workflow = t
    ? {
        id,
        name: t.workflowName,
        state: 'draft',
        version: 0,
        trigger: structuredClone(t.trigger),
        conditions: structuredClone(t.conditions),
        action: structuredClone(t.action),
        configured: { trigger: true, conditions: true, action: true },
        audit: [{ text: `Created from Marketplace template “${t.name}”`, actor: ME_ROLE, time: nowLabel(), at: Date.now() }],
      }
    : {
        id,
        name: 'Untitled workflow',
        state: 'draft',
        version: 0,
        trigger: { kind: 'threshold', dataset: '', cadence: '', trustGate: true },
        conditions: { match: 'all', rules: [] },
        action: { type: '', target: '', approver: 'finance', retry: 'backoff-3' },
        configured: { trigger: false, conditions: false, action: false },
        audit: [{ text: 'Created blank workflow', actor: ME_ROLE, time: nowLabel(), at: Date.now() }],
      }
  setState({ ...state, workflows: [...state.workflows, workflow] })
  return id
}

const changed = (w: Workflow) => ({ unpublishedChanges: w.state !== 'draft' })

export function renameWorkflow(id: string, name: string) {
  patchWorkflow(id, (w) => ({ name, ...changed(w) }), `Renamed workflow to “${name}”`)
}

export function saveTrigger(id: string, trigger: Trigger) {
  patchWorkflow(
    id,
    (w) => {
      // A recurring schedule has no row conditions, and rules for another
      // dataset's fields no longer apply once the dataset changes.
      const clear = trigger.kind === 'schedule' || trigger.dataset !== w.trigger.dataset
      return {
        trigger,
        conditions: clear ? { ...w.conditions, rules: [] } : w.conditions,
        configured: { ...w.configured, trigger: true, conditions: trigger.kind === 'schedule' || (!clear && w.configured.conditions) },
        ...changed(w),
      }
    },
    'Saved trigger configuration',
  )
}

export function saveConditions(id: string, conditions: Conditions) {
  patchWorkflow(
    id,
    (w) => ({ conditions, configured: { ...w.configured, conditions: true }, ...changed(w) }),
    'Saved filter conditions',
  )
}

export function saveAction(id: string, action: Action) {
  patchWorkflow(id, (w) => ({ action, configured: { ...w.configured, action: true }, ...changed(w) }), 'Saved action configuration')
}

export function publishWorkflow(id: string) {
  const w = state.workflows.find((x) => x.id === id)
  if (!w) return
  const version = w.version + 1
  patchWorkflow(id, () => ({ state: 'published', version, unpublishedChanges: false }), `Published workflow v${version}`)
}

export function setPaused(id: string, paused: boolean) {
  patchWorkflow(id, () => ({ state: paused ? 'paused' : 'published' }), paused ? 'Paused workflow' : 'Resumed workflow')
}

/** Records a dry run. Nothing leaves DataPilot. */
export function recordTest(workflowId: string, summary: string, steps: Step[]): string {
  const id = nextRunId()
  const run: Run = { id, workflowId, outcome: 'test', approvedBy: 'Dry run (test)', time: nowLabel(), at: Date.now(), inLast7d: false, summary, steps }
  setState({ ...state, runs: [run, ...state.runs] })
  patchWorkflow(workflowId, () => ({}), `Ran dry-run test ${id}`)
  return id
}

/* -------------------------------------------------------------- approvals */

function finishRun(runId: string, result: string) {
  setState({
    ...state,
    runs: state.runs.map((r) =>
      r.id === runId
        ? {
            ...r,
            outcome: 'executed',
            at: Date.now(),
            steps: r.steps.map((s) =>
              s.status === 'running' ? { ...s, title: 'Action executed', detail: result, time: nowLabel(true), status: 'ok', note: 'Sent' } : s,
            ),
          }
        : r,
    ),
  })
}

/**
 * Approves a pending request: records the decision, creates a run and
 * "executes" it after a short delay. `trustWarning` is kept in the audit trail
 * when someone approves while the source data has a Trust problem.
 */
export function approveRequest(requestId: string, trustWarning?: string): string | undefined {
  const req = state.requests.find((r) => r.id === requestId)
  if (!req || req.status !== 'pending') return
  const wf = state.workflows.find((w) => w.id === req.workflowId)
  const runId = nextRunId()
  const target = wf?.action.target ?? ''
  const run: Run = {
    id: runId,
    workflowId: req.workflowId,
    requestId,
    outcome: 'running',
    approvedBy: ME,
    time: nowLabel(),
    at: Date.now(),
    inLast7d: true,
    summary: req.title,
    steps: [
      { title: 'Trigger evaluated', detail: `Evaluation that queued ${requestId}.`, time: req.queued, status: 'ok', note: 'OK' },
      {
        title: 'Conditions matched',
        detail: req.matched.length ? `${req.matched.length} rows matched: ${req.matched.join(', ')}.` : 'No row conditions (scheduled or ad-hoc run).',
        time: req.queued,
        status: 'ok',
        note: req.matched.length ? `${req.matched.length} rows` : 'OK',
      },
      {
        title: 'Human approval verified',
        detail: `${requestId} approved by ${ME_ROLE} in the Approval Center.${trustWarning ? ` Approved despite Trust warning: ${trustWarning}` : ''}`,
        time: nowLabel(true),
        status: 'ok',
        note: trustWarning ? 'Approved with warning' : 'Approved',
      },
      { title: 'Executing action', detail: `Delivering to ${target}.`, time: nowLabel(true), status: 'running', note: 'Running' },
    ],
  }
  setState({
    ...state,
    requests: state.requests.map((r) => (r.id === requestId ? { ...r, status: 'approved', decidedBy: ME, decidedAt: nowLabel(), runId } : r)),
    runs: [run, ...state.runs],
  })
  patchWorkflow(req.workflowId, () => ({}), `Approved run ${runId}${trustWarning ? ' with a Trust warning' : ''}`)
  window.setTimeout(() => finishRun(runId, `Delivered to ${target}.`), EXECUTE_MS)
  return runId
}

export function rejectRequest(requestId: string, reason: string) {
  const req = state.requests.find((r) => r.id === requestId)
  if (!req || req.status !== 'pending') return
  const runId = nextRunId()
  const run: Run = {
    id: runId,
    workflowId: req.workflowId,
    requestId,
    outcome: 'rejected',
    approvedBy: ME,
    time: nowLabel(),
    at: Date.now(),
    inLast7d: false,
    summary: req.title,
    steps: [
      { title: 'Trigger evaluated', detail: `Evaluation that queued ${requestId}.`, time: req.queued, status: 'ok', note: 'OK' },
      { title: 'Conditions matched', detail: req.matched.length ? `${req.matched.join(', ')}.` : 'No row conditions.', time: req.queued, status: 'ok', note: 'OK' },
      { title: 'Rejected by approver', detail: `${ME_ROLE}${reason ? `: “${reason}”` : '. No reason given.'}`, time: nowLabel(true), status: 'error', note: 'Rejected' },
      { title: 'Action not executed', detail: 'Nothing was sent.', time: nowLabel(true), status: 'skipped', note: 'Skipped' },
    ],
  }
  setState({
    ...state,
    requests: state.requests.map((r) =>
      r.id === requestId ? { ...r, status: 'rejected', decidedBy: ME, decidedAt: nowLabel(), reason, runId } : r,
    ),
    runs: [run, ...state.runs],
  })
  patchWorkflow(req.workflowId, () => ({}), `Rejected ${requestId}${reason ? `: “${reason}”` : ''}`)
}

/** Manual retry of a failed run, re-using its existing approval. */
export function retryRun(runId: string) {
  const run = state.runs.find((r) => r.id === runId)
  if (!run || run.outcome !== 'failed') return
  const target = state.workflows.find((w) => w.id === run.workflowId)?.action.target ?? ''
  setState({
    ...state,
    runs: state.runs.map((r) =>
      r.id === runId
        ? {
            ...r,
            outcome: 'running',
            at: Date.now(),
            steps: [
              ...r.steps,
              {
                title: 'Manual retry',
                detail: `Retry requested by ${ME_ROLE}, using the existing approval. Delivering to ${target}.`,
                time: nowLabel(true),
                status: 'running',
                note: 'Running',
              },
            ],
          }
        : r,
    ),
  })
  patchWorkflow(run.workflowId, () => ({}), `Retried ${runId} manually`)
  window.setTimeout(() => finishRun(runId, `Retry succeeded: delivered to ${target}.`), EXECUTE_MS)
}
