import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { fieldClass } from '../styles'
import { cn } from '../../../lib/cn'
import { approverById, type ApprovalRequest, type Workflow } from '../data'
import { AutomateHeader, AutomateTabs, OutcomeBadge, WarningNote } from '../components/parts'
import { approveRequest, rejectRequest, useAutomateState } from '../store'
import { useDatasetTrust } from '../trust'

type Pending = { kind: 'approve' | 'reject'; request: ApprovalRequest; warning?: string; trustTo?: string }

/** Approval center (designed: automate_approval_center). */
export function ApprovalsPage() {
  usePageChrome([{ label: 'Automate', to: '/automate' }, { label: 'Approval Center' }])
  const toast = useToast()
  const { requests, runs, workflows } = useAutomateState()
  const [dialog, setDialog] = useState<Pending | null>(null)
  const [reason, setReason] = useState('')

  const pending = requests.filter((r) => r.status === 'pending')
  const executed = runs.filter((r) => r.requestId && r.outcome !== 'rejected' && r.outcome !== 'test').slice(0, 5)

  const approve = (request: ApprovalRequest, warning?: string) => {
    const runId = approveRequest(request.id, warning)
    setDialog(null)
    if (runId) toast(`Approved ${request.id}. ${runId} is executing.`)
  }

  const reject = () => {
    if (!dialog) return
    rejectRequest(dialog.request.id, reason.trim())
    toast(`Rejected ${dialog.request.id}. Nothing was sent.`, 'info')
    setDialog(null)
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        title="Approval Center"
        description="Review recommended workflow actions before they execute. Nothing runs externally until approved."
      />
      <AutomateTabs />

      <section className="flex flex-col gap-3" aria-labelledby="pending-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pending-heading" className="font-title text-title-md text-light-on-surface tabular-nums">
            Pending approval ({pending.length} recommended {pending.length === 1 ? 'action' : 'actions'})
          </h2>
          {pending.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-warning-container text-on-warning-container font-label text-label-sm">Awaiting human sign-off</span>
          )}
        </div>
        {pending.length === 0 && (
          <p className="bg-light-surface border border-light-outline-variant rounded-md p-5 font-body text-body-md text-light-on-surface-variant">
            Nothing is waiting for approval. Decisions made this session are listed below.
          </p>
        )}
        {requests.map((r) => {
            const wf = workflows.find((w) => w.id === r.workflowId)
            return wf ? (
              <RequestCard
                key={r.id}
                request={r}
                workflow={wf}
                onApprove={(warning, trustTo) => (warning ? setDialog({ kind: 'approve', request: r, warning, trustTo }) : approve(r))}
                onReject={() => {
                  setReason('')
                  setDialog({ kind: 'reject', request: r })
                }}
              />
            ) : null
          })}
      </section>

      <section className="flex flex-col gap-3 pt-2" aria-labelledby="executed-heading">
        <h2 id="executed-heading" className="font-title text-title-md text-light-on-surface">
          Recently executed (approved runs)
        </h2>
        <div className="bg-light-surface border border-light-outline-variant rounded-md divide-y divide-light-outline-variant">
          {executed.map((run) => (
            <div key={run.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <Link to={`/automate/runs/${run.id}`} className="font-label text-label-md text-light-primary hover:underline">
                  {run.summary}
                </Link>
                <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                  <span className="font-mono text-mono-sm">{run.id}</span> · Approved by {run.approvedBy} · {run.time}
                </p>
              </div>
              <div className="shrink-0">
                <OutcomeBadge outcome={run.outcome} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <Modal
        open={dialog?.kind === 'approve'}
        onClose={() => setDialog(null)}
        title="Approve despite a Trust warning?"
        description={dialog?.request.title}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialog(null)}>
              Keep pending
            </Button>
            <Button size="sm" onClick={() => dialog && approve(dialog.request, dialog.warning)}>
              Approve with warning
            </Button>
          </>
        }
      >
        <p className="font-body text-body-md text-light-on-surface">
          {dialog?.warning} The figures in this request may be wrong. Your approval and this warning are recorded in the audit trail.
        </p>
        {dialog?.trustTo && (
          <Link to={dialog.trustTo} className="inline-block mt-3 font-label text-label-md text-light-primary hover:underline">
            Review the issue in Trust first
          </Link>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === 'reject'}
        onClose={() => setDialog(null)}
        title={`Reject ${dialog?.request.id ?? ''}?`}
        description={dialog?.request.title}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialog(null)}>
              Keep pending
            </Button>
            <Button variant="danger" size="sm" onClick={reject}>
              Reject request
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reject-reason" className="font-label text-label-md text-light-on-surface">
            Reason (optional)
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Already handled by phone"
            className={cn(fieldClass, 'border-light-outline resize-y')}
          />
          <p className="font-body text-body-sm text-light-on-surface-variant">Nothing is sent. The rejection is kept in the execution history.</p>
        </div>
      </Modal>
    </div>
  )
}

function RequestCard({
  request: r,
  workflow,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest
  workflow: Workflow
  onApprove: (warning?: string, trustTo?: string) => void
  onReject: () => void
}) {
  const trust = useDatasetTrust(workflow.trigger.dataset)
  const decided = r.status !== 'pending'
  return (
    <article
      className={cn(
        'border rounded-md p-5 flex flex-col md:flex-row md:items-center justify-between gap-4',
        decided ? 'bg-light-surface-container-low border-light-outline-variant' : 'bg-light-surface border-light-outline-variant',
      )}
    >
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {trust.healthy || decided ? (
            <span className="px-2 py-0.5 rounded-sm bg-info-container text-on-info-container font-label text-label-sm">
              {decided ? 'Decided' : 'Recommended · not executed'}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-sm bg-warning-container text-on-warning-container font-label text-label-sm">Trust warning · {trust.label}</span>
          )}
          <span className="font-mono text-mono-sm text-light-on-surface-variant">
            {r.id} · queued {r.queued}
          </span>
        </div>
        <h3 className="font-title text-title-md text-light-on-surface">{r.title}</h3>
        <p className="font-body text-body-sm text-light-on-surface-variant">{r.detail}</p>
        <p className="font-body text-body-sm text-light-on-surface-variant">
          <Link to={`/automate/workflows/${workflow.id}`} className="text-light-primary hover:underline">
            {workflow.name}
          </Link>{' '}
          · Approver: {approverById(workflow.action.approver)?.label}
        </p>
        {!trust.healthy && !decided && (
          <WarningNote to={trust.to}>
            {trust.detail}{' '}
            {workflow.trigger.trustGate
              ? 'This request was queued before the issue was detected.'
              : 'This workflow’s Trust gate is off, so the request was queued anyway.'}
          </WarningNote>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {decided ? (
          <span className="px-3 py-1 rounded bg-light-surface-container font-label text-label-md text-light-on-surface">
            {r.status === 'approved' ? 'Approved & queued' : 'Rejected'}
            {r.runId && (
              <>
                {' · '}
                <Link to={`/automate/runs/${r.runId}`} className="text-light-primary hover:underline">
                  {r.runId}
                </Link>
              </>
            )}
          </span>
        ) : (
          <>
            <Button variant="secondary" size="sm" className="text-error" onClick={onReject} aria-label={`Reject ${r.id}`}>
              Reject
            </Button>
            <Button size="sm" onClick={() => onApprove(trust.healthy ? undefined : trust.detail, trust.to)} aria-label={`Approve and execute ${r.id}`}>
              Approve &amp; execute
            </Button>
          </>
        )}
      </div>
    </article>
  )
}
