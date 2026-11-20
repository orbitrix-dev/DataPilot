import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../components/ui/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { NOW_ISO, formatDuration, formatNumber } from '../format'
import { recordRun } from '../store'
import { btnBack, btnPrimary } from '../styles'
import { useWizard } from './context'

/** Step 7 — Results (extrapolated): summary of the finished initial sync and next actions. */
export function ResultsStep() {
  const { form, preset, selectedDatasets, modes, syncElapsed, connectionId, commitConnection } = useWizard()
  const committed = useRef(false)
  const total = selectedDatasets.reduce((s, d) => s + d.rows, 0)

  // Persist the new connection (and its first run) into the Connect store once results are shown.
  useEffect(() => {
    if (committed.current) return
    committed.current = true
    commitConnection()
    recordRun({
      connectionId,
      source: form.name,
      status: 'succeeded',
      records: total,
      durationSeconds: syncElapsed ?? 0,
      timestamp: NOW_ISO,
      trigger: 'Manual',
    })
  }, [commitConnection, connectionId, form.name, total, syncElapsed])

  const metrics = [
    { label: 'Records synced', value: formatNumber(total) },
    { label: 'Datasets', value: `${selectedDatasets.length} tables` },
    { label: 'Sync schedule', value: form.schedule },
  ]

  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-lg">
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 rounded bg-success-container text-on-success-container flex items-center justify-center shrink-0">
          <Icon name="check_circle" size={22} />
        </span>
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">{form.name} is connected</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1 tabular-nums">
            Initial sync completed{syncElapsed !== null ? ` in ${formatDuration(syncElapsed)}` : ''} with read-only{' '}
            {preset.label} access. Data is now available to Trust validation and Insights.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        {metrics.map((m) => (
          <div key={m.label} className="bg-light-surface border border-light-outline-variant rounded-md p-5">
            <span className="font-label text-label-md text-light-on-surface-variant">{m.label}</span>
            <p className="font-title text-title-lg text-light-on-surface mt-1 tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-light-outline-variant border border-light-outline-variant rounded-md">
        {selectedDatasets.map((d) => (
          <div key={d.name} className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-mono-sm text-light-on-surface">{d.name}</p>
              <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                {formatNumber(d.rows)} rows · {(modes[d.name] ?? 'incremental') === 'full' ? 'Full refresh' : `Incremental on ${d.cursor}`}
              </p>
            </div>
            <StatusBadge tone="success">Completed</StatusBadge>
          </div>
        ))}
      </div>

      <footer className="pt-4 border-t border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
        <Link to="/connect" className={btnBack}>
          Back to Connect
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/connect/history" className={btnBack}>
            Sync history
          </Link>
          <Link to={`/connect/connections/${connectionId}`} className={btnPrimary}>
            View connection details
          </Link>
        </div>
      </footer>
    </section>
  )
}
