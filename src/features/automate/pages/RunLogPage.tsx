import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { retryById, type Run, type StepStatus } from '../data'
import { AutomateHeader, ButtonLink, OutcomeBadge } from '../components/parts'
import { retryRun, useAutomateState } from '../store'

const stepTone: Record<StepStatus, { row: string; title: string; note: string; icon: string }> = {
  ok: { row: '', title: 'text-light-on-surface', note: 'text-success', icon: 'check_circle' },
  error: { row: 'bg-error-container', title: 'text-on-error-container', note: 'text-on-error-container', icon: 'error' },
  skipped: { row: '', title: 'text-light-on-surface', note: 'text-light-on-surface-variant', icon: 'remove_circle_outline' },
  running: { row: 'bg-light-primary-container', title: 'text-light-on-primary-container', note: 'text-light-on-primary-container', icon: 'progress_activity' },
}

/** Execution logs for one run (designed: automate_execution_logs). */
export function RunLogPage() {
  const { runId = '' } = useParams()
  const { runs, workflows } = useAutomateState()
  const toast = useToast()
  const run = runs.find((r) => r.id === runId)
  usePageChrome([
    { label: 'Automate', to: '/automate' },
    { label: 'Execution history', to: '/automate/history' },
    { label: runId },
  ])

  if (!run) {
    return (
      <div className="max-w-xl w-full mx-auto bg-light-surface border border-light-outline-variant rounded-md p-8 flex flex-col items-center text-center gap-3">
        <Icon name="search_off" size={32} className="text-light-on-surface-variant" />
        <h1 className="font-title text-title-lg text-light-on-surface">{runId} was not found</h1>
        <p className="font-body text-body-md text-light-on-surface-variant">Runs created here last until you reload the page.</p>
        <ButtonLink to="/automate/history">Back to execution history</ButtonLink>
      </div>
    )
  }

  const workflow = workflows.find((w) => w.id === run.workflowId)
  const retry = () => {
    retryRun(run.id)
    toast(`Manual retry queued for ${run.id} using the existing approval.`, 'info')
  }

  return (
    <div className="max-w-4xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        eyebrow={
          <>
            <RunBadge run={run} max={retryById(workflow?.action.retry ?? '')?.max ?? 3} />
            <span className="font-mono text-mono-sm text-light-on-surface-variant">{run.id}</span>
            {run.requestId && <span className="font-mono text-mono-sm text-light-on-surface-variant">· {run.requestId}</span>}
          </>
        }
        title={workflow?.name ?? run.workflowId}
        description={
          <>
            {run.summary} · {run.time}
            {workflow && (
              <>
                {' · '}
                <Link to={`/automate/workflows/${workflow.id}`} className="text-light-primary hover:underline">
                  Workflow details
                </Link>
              </>
            )}
          </>
        }
        actions={run.outcome === 'failed' && <Button onClick={retry}>Retry action now</Button>}
      />

      <section aria-label="Step trace" className="bg-light-surface border border-light-outline-variant rounded-md divide-y divide-light-outline-variant overflow-hidden">
        {run.steps.map((s, i) => {
          const t = stepTone[s.status]
          return (
            <div key={i} className={cn('p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4', t.row)}>
              <div className="flex items-start gap-3 min-w-0">
                <Icon name={t.icon} size={18} className={cn('shrink-0 mt-0.5', t.note, s.status === 'running' && 'animate-spin')} />
                <div className="min-w-0">
                  <p className={cn('font-label text-label-md', t.title)}>
                    {i + 1}. {s.title}
                  </p>
                  <p className={cn('font-body text-body-sm', s.status === 'error' || s.status === 'running' ? t.title : 'text-light-on-surface-variant')}>{s.detail}</p>
                </div>
              </div>
              <span className={cn('font-mono text-mono-sm whitespace-nowrap tabular-nums pl-7 sm:pl-0', t.note)}>
                {s.time}
                {s.note && ` · ${s.note}`}
              </span>
            </div>
          )
        })}
      </section>

      {run.outcome === 'test' && (
        <p className="font-body text-body-sm text-light-on-surface-variant">Dry runs never send anything and are not counted in the run KPIs.</p>
      )}
    </div>
  )
}

function RunBadge({ run, max }: { run: Run; max: number }) {
  if (run.outcome === 'failed') {
    return (
      <span className="px-2.5 py-0.5 rounded-sm bg-error-container text-on-error-container font-label text-label-sm tabular-nums">
        Delivery error · {run.retriesUsed ?? 0}/{max} retries used
      </span>
    )
  }
  return <OutcomeBadge outcome={run.outcome} />
}
