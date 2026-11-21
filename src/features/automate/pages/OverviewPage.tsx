import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { approvalLabel, workflowSubtitle } from '../evaluate'
import { AutomateHeader, AutomateTabs, ButtonLink, StateBadge } from '../components/parts'
import { createWorkflow, setPaused, useAutomateState } from '../store'

const th = 'px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant'
const linkClass = 'font-label text-label-md text-light-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary rounded-sm'

/** Automation overview (designed: automate_overview). */
export function OverviewPage() {
  usePageChrome([{ label: 'Automate' }])
  const toast = useToast()
  const navigate = useNavigate()
  const { workflows, requests, runs } = useAutomateState()

  const published = workflows.filter((w) => w.state === 'published').length
  const paused = workflows.filter((w) => w.state === 'paused').length
  const drafts = workflows.filter((w) => w.state === 'draft').length
  const pending = requests.filter((r) => r.status === 'pending').length
  const recent = runs.filter((r) => r.inLast7d && (r.outcome === 'executed' || r.outcome === 'failed'))
  const succeeded = recent.filter((r) => r.outcome === 'executed').length
  const failed = runs.filter((r) => r.outcome === 'failed')

  const togglePause = (id: string, name: string, pause: boolean) => {
    setPaused(id, pause)
    toast(pause ? `Paused “${name}”. No evaluations will run until it is resumed.` : `Resumed “${name}”.`, pause ? 'info' : 'success')
  }

  return (
    <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        title="Controlled workflow automation"
        description="Every workflow is permission-scoped, auditable, and requires explicit approval before external execution."
        actions={
          <>
            <ButtonLink to="/automate/marketplace">Browse templates</ButtonLink>
            <Button onClick={() => navigate(`/automate/workflows/${createWorkflow()}/builder`)}>Create workflow</Button>
          </>
        }
      />
      <AutomateTabs />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Published workflows" value={published} caption={`${paused} paused · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`} />
        <Kpi
          label="Pending human approval"
          value={pending}
          valueClass={pending ? 'text-warning' : undefined}
          caption={
            <Link to="/automate/approvals" className={linkClass}>
              {pending ? 'Review queue →' : 'Queue is clear →'}
            </Link>
          }
        />
        <Kpi
          label="Approved runs (7d)"
          value={recent.length}
          caption={recent.length ? `${succeeded} of ${recent.length} succeeded` : 'No runs yet'}
          captionClass={recent.length && succeeded === recent.length ? 'text-success' : undefined}
        />
        <Kpi
          label="Failed runs"
          value={failed.length}
          valueClass={failed.length ? 'text-error' : undefined}
          caption={
            failed.length ? (
              <Link to={`/automate/runs/${failed[0].id}`} className={linkClass}>
                Inspect {failed[0].id} →
              </Link>
            ) : (
              'No failures'
            )
          }
        />
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-title text-title-md text-light-on-surface">Configured workflows</h2>
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            Showing {workflows.length} organization workflows
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
                <th className={th}>Workflow</th>
                <th className={th}>State</th>
                <th className={th}>Approval gate</th>
                <th className={th}>Last run</th>
                <th className={`${th} text-right`}>Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-outline-variant">
              {workflows.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-3.5 min-w-[280px]">
                    <Link to={`/automate/workflows/${w.id}`} className={linkClass}>
                      {w.name}
                    </Link>
                    <p className="font-body text-body-sm text-light-on-surface-variant">{workflowSubtitle(w)}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col items-start gap-1">
                      <StateBadge state={w.state} />
                      {w.unpublishedChanges && <span className="font-body text-body-sm text-light-on-surface-variant">Unpublished changes</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface whitespace-nowrap">{approvalLabel(w)}</td>
                  <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant tabular-nums whitespace-nowrap">
                    {w.lastRun ?? 'Not yet run'}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap space-x-3">
                    <Link to={`/automate/workflows/${w.id}/builder`} className={linkClass} aria-label={`${w.state === 'draft' ? 'Configure' : 'Edit'} ${w.name}`}>
                      {w.state === 'draft' ? 'Configure' : 'Edit'}
                    </Link>
                    {w.state !== 'draft' && (
                      <button
                        type="button"
                        onClick={() => togglePause(w.id, w.name, w.state === 'published')}
                        aria-label={`${w.state === 'published' ? 'Pause' : 'Resume'} ${w.name}`}
                        className={
                          w.state === 'published'
                            ? 'font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary'
                            : linkClass
                        }
                      >
                        {w.state === 'published' ? 'Pause' : 'Resume'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Kpi({
  label,
  value,
  caption,
  valueClass,
  captionClass,
}: {
  label: string
  value: number
  caption: ReactNode
  valueClass?: string
  captionClass?: string
}) {
  return (
    <div className="bg-light-surface border border-light-outline-variant rounded-md p-4">
      <span className="font-label text-label-md text-light-on-surface-variant">{label}</span>
      <p className={`font-headline text-headline-md mt-2 tabular-nums ${valueClass ?? 'text-light-on-surface'}`}>{value}</p>
      <p className={`font-body text-body-sm mt-1 tabular-nums ${captionClass ?? 'text-light-on-surface-variant'}`}>{caption}</p>
    </div>
  )
}
