import { Link, useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { cadenceById } from '../data'
import { approvalLabel } from '../evaluate'
import { AutomateHeader, AutomateTabs } from '../components/parts'
import { createWorkflow, useAutomateState } from '../store'

const th = 'px-4 py-3 font-label text-label-sm uppercase text-light-on-surface-variant'

/** Scheduled workflows (designed: automate_scheduled_workflows). */
export function ScheduledPage() {
  usePageChrome([{ label: 'Automate', to: '/automate' }, { label: 'Scheduled' }])
  const navigate = useNavigate()
  const { workflows } = useAutomateState()
  const scheduled = workflows.filter((w) => w.state !== 'draft' && cadenceById(w.trigger.cadence)?.next)

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-6">
      <AutomateHeader
        title="Scheduled workflows"
        description="Recurring evaluation schedules. Approval-gated workflows queue a sign-off request at each scheduled time."
        actions={<Button onClick={() => navigate(`/automate/workflows/${createWorkflow()}/trigger`)}>New schedule</Button>}
      />
      <AutomateTabs />

      <div className="bg-light-surface border border-light-outline-variant rounded-md overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={th}>Workflow</th>
              <th className={th}>Cadence (UTC)</th>
              <th className={th}>Next evaluation</th>
              <th className={th}>Gate</th>
              <th className={`${th} text-right`}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {scheduled.map((w) => {
              const cadence = cadenceById(w.trigger.cadence)!
              const paused = w.state === 'paused'
              return (
                <tr key={w.id}>
                  <td className="px-4 py-3.5 min-w-[240px]">
                    <Link to={`/automate/workflows/${w.id}`} className="font-label text-label-md text-light-primary hover:underline">
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-mono-sm text-light-on-surface-variant whitespace-nowrap">{cadence.short}</td>
                  <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface tabular-nums whitespace-nowrap">
                    {paused ? <span className="text-light-on-surface-variant">Not scheduled while paused</span> : cadence.next}
                  </td>
                  <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface whitespace-nowrap">
                    {approvalLabel(w)}
                    {w.trigger.trustGate && <span className="block text-light-on-surface-variant">+ Trust freshness gate</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <StatusBadge tone={paused ? 'warning' : 'success'}>{paused ? 'Paused' : 'Active'}</StatusBadge>
                  </td>
                </tr>
              )
            })}
            {scheduled.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center font-body text-body-md text-light-on-surface-variant">
                  No published workflows run on a schedule.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-body text-body-sm text-light-on-surface-variant">
        Event-driven workflows (run after each sync) are not listed here. See{' '}
        <Link to="/automate" className="text-light-primary hover:underline">
          all workflows
        </Link>
        .
      </p>
    </div>
  )
}
