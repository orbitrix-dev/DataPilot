import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { useConnectState } from '../../connect/store'
import { approverById, cadenceById, datasetById, type Workflow } from '../data'
import { conditionsText, requiresApproval, scopesOf } from '../evaluate'
import { AutomateHeader, ButtonLink, OutcomeBadge, StateBadge, WarningNote, WorkflowNotFound } from '../components/parts'
import { setPaused, useAutomateState } from '../store'
import { useDatasetTrust } from '../trust'

/** Workflow details (designed: automate_workflow_details). */
export function DetailsPage() {
  const { workflowId = '' } = useParams()
  const { workflows } = useAutomateState()
  const workflow = workflows.find((w) => w.id === workflowId)
  usePageChrome([{ label: 'Automate', to: '/automate' }, { label: workflow?.id ?? workflowId }])
  if (!workflow) return <WorkflowNotFound id={workflowId} />
  return <Details workflow={workflow} />
}

const row = 'flex flex-wrap justify-between gap-x-4 gap-y-0.5'

function Details({ workflow: w }: { workflow: Workflow }) {
  const toast = useToast()
  const { runs } = useAutomateState()
  const { connections } = useConnectState()
  const trust = useDatasetTrust(w.trigger.dataset)
  const scopes = scopesOf(w)
  const needsApproval = requiresApproval(w)
  const recent = runs.filter((r) => r.workflowId === w.id).slice(0, 5)
  const failingSources = w.trigger.dataset === 'connect.sync_runs' ? connections.filter((c) => c.status === 'failed') : []

  const toggle = () => {
    const pause = w.state === 'published'
    setPaused(w.id, pause)
    toast(pause ? `Paused ${w.id}. No evaluations will run until it is resumed.` : `Resumed ${w.id}.`, pause ? 'info' : 'success')
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        eyebrow={
          <>
            <StateBadge state={w.state} />
            <span className="font-mono text-mono-sm text-light-on-surface-variant">
              {w.id}
              {w.version > 0 && ` · v${w.version}`}
            </span>
            {w.unpublishedChanges && <span className="font-label text-label-sm text-warning">Unpublished changes</span>}
          </>
        }
        title={w.name}
        actions={
          <>
            {w.state !== 'draft' && (
              <Button variant="secondary" size="sm" onClick={toggle}>
                {w.state === 'published' ? 'Pause workflow' : 'Resume workflow'}
              </Button>
            )}
            <ButtonLink to={`/automate/workflows/${w.id}/builder`} variant="primary">
              {w.state === 'draft' ? 'Continue in builder' : 'Edit in builder'}
            </ButtonLink>
          </>
        }
      />

      {w.state === 'paused' && failingSources.length > 0 && (
        <WarningNote to={`/connect/connections/${failingSources[0].id}`}>
          {failingSources.map((c) => c.name).join(', ')} is failing in Connect right now, and operations are not being paged because this workflow is paused.
        </WarningNote>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Permission configuration</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant">Least-privilege access enforced for this workflow:</p>
          <ul className="space-y-2 font-body text-body-sm text-light-on-surface">
            <li className={row}>
              <span>Dataset read scope</span>
              <span className="font-mono text-mono-sm">{scopes.read.join(', ') || 'None'}</span>
            </li>
            <li className={row}>
              <span>Action scope</span>
              <span className="font-mono text-mono-sm">{scopes.action.join(', ') || 'Not set'}</span>
            </li>
            <li className={row}>
              <span>Allowed editors</span>
              <span className="font-label text-label-md">Admin, {approverById(w.action.approver)?.short}</span>
            </li>
          </ul>
        </section>

        <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Approval requirements</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant">Human sign-off policy before external action:</p>
          <ul className="space-y-2 font-body text-body-sm text-light-on-surface">
            <li className={row}>
              <span>Approval mode</span>
              <span className="font-label text-label-md text-light-primary">{needsApproval ? 'Mandatory per run' : 'Pre-approved (read-only alert)'}</span>
            </li>
            <li className={row}>
              <span>Authorized approvers</span>
              <span className="font-label text-label-md">{needsApproval ? approverById(w.action.approver)?.people : 'Not required'}</span>
            </li>
            <li className={row}>
              <span>Trust freshness gate</span>
              {!w.trigger.trustGate ? (
                <span className="font-label text-label-md text-light-on-surface-variant">Disabled</span>
              ) : trust.healthy ? (
                <span className="font-label text-label-md text-success">Enabled (&lt;2h stale) · passing</span>
              ) : (
                <span className="font-label text-label-md text-warning">
                  Enabled · holding ({trust.to ? <Link to={trust.to} className="underline">{trust.label}</Link> : trust.label})
                </span>
              )}
            </li>
          </ul>
        </section>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-5 flex flex-col gap-2">
        <h2 className="font-title text-title-md text-light-on-surface">Configuration</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-4 gap-y-2 font-body text-body-sm">
          <dt className="text-light-on-surface-variant">Trigger</dt>
          <dd className="text-light-on-surface">
            {cadenceById(w.trigger.cadence)?.label ?? 'Not set'}
            {datasetById(w.trigger.dataset) && (
              <>
                {' '}on <span className="font-mono text-mono-sm">{w.trigger.dataset}</span>
              </>
            )}
          </dd>
          <dt className="text-light-on-surface-variant">Conditions</dt>
          <dd className="font-mono text-mono-sm text-light-on-surface break-words">{conditionsText(w)}</dd>
          <dt className="text-light-on-surface-variant">Action</dt>
          <dd className="text-light-on-surface">{w.action.target || 'Not set'}</dd>
        </dl>
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-light-outline-variant">
          <h2 className="font-title text-title-md text-light-on-surface">Recent runs</h2>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-4 font-body text-body-sm text-light-on-surface-variant">No runs yet. Test the workflow from the builder to see a dry-run trace.</p>
        ) : (
          <div className="divide-y divide-light-outline-variant">
            {recent.map((r) => (
              <div key={r.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link to={`/automate/runs/${r.id}`} className="font-mono text-mono-sm text-light-primary hover:underline">
                    {r.id}
                  </Link>
                  <span className="font-body text-body-sm text-light-on-surface-variant"> · {r.summary}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">{r.time}</span>
                  <OutcomeBadge outcome={r.outcome} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-light-outline-variant">
          <h2 className="font-title text-title-md text-light-on-surface">Workflow audit trail</h2>
        </div>
        <div className="divide-y divide-light-outline-variant">
          {w.audit.map((a, i) => (
            <div key={i} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-label text-label-md text-light-on-surface">{a.text}</p>
                <p className="font-body text-body-sm text-light-on-surface-variant">{a.actor}</p>
              </div>
              <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">{a.time}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
