import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../../components/ui/Toast'
import { ProgressBar } from '../components/ProgressBar'
import { StatusBadge } from '../components/StatusBadge'
import { formatDuration, formatNumber } from '../format'
import { btnBack, btnPrimary, btnSecondary } from '../styles'
import { useWizard } from './context'

const TICK_MS = 200
const TICKS_TO_COMPLETE = 50
/** Simulated seconds that pass per tick (so the elapsed clock reads like a real sync). */
const SIM_SECONDS_PER_TICK = 2

/** Step 6 — Initial sync (designed: connect_sync_progress). Progress is simulated on an interval. */
export function SyncStep() {
  const { form, selectedDatasets, goTo, setSyncElapsed, commitConnection } = useWizard()
  const navigate = useNavigate()
  const toast = useToast()
  const total = selectedDatasets.reduce((s, d) => s + d.rows, 0)
  const [progress, setProgress] = useState({ processed: 0, elapsed: 0 })
  const [paused, setPaused] = useState(false)
  const done = progress.processed >= total

  useEffect(() => {
    if (paused || done) return
    const step = Math.ceil(total / TICKS_TO_COMPLETE)
    const id = window.setInterval(() => {
      setProgress((p) => ({
        processed: Math.min(total, p.processed + step),
        elapsed: p.elapsed + SIM_SECONDS_PER_TICK,
      }))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [paused, done, total])

  useEffect(() => {
    if (done && total > 0) toast(`Initial sync complete — ${formatNumber(total)} records`)
  }, [done, total, toast])

  const pct = total === 0 ? 100 : Math.floor((progress.processed / total) * 100)

  // Tables sync sequentially; derive each table's processed rows from the overall counter.
  let offset = 0
  const tables = selectedDatasets.map((d) => {
    const rows = Math.max(0, Math.min(d.rows, progress.processed - offset))
    offset += d.rows
    return { ...d, processedRows: rows }
  })

  const togglePause = () => {
    setPaused((p) => !p)
    toast(paused ? 'Sync resumed' : 'Sync paused — no further rows will be read until resumed', paused ? 'info' : 'warning')
  }

  const runInBackground = () => {
    commitConnection()
    toast(`${form.name} keeps syncing in the background`, 'info')
    navigate('/connect')
  }

  const viewResults = () => {
    setSyncElapsed(progress.elapsed)
    goTo('results')
  }

  return (
    <div className="max-w-4xl w-full mx-auto">
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div aria-live="polite">
            <h1 className="font-headline text-headline-lg text-light-on-surface">
              {done ? `Synced ${form.name}` : `${paused ? 'Paused' : 'Syncing'} ${form.name}`}
            </h1>
            <p className="font-body text-body-md text-light-on-surface-variant mt-1 tabular-nums">
              {formatNumber(progress.processed)} of {formatNumber(total)} records processed · Elapsed{' '}
              {formatDuration(progress.elapsed)}
            </p>
          </div>
          <StatusBadge tone={done ? 'success' : paused ? 'warning' : 'primary'} size="md">
            {paused && !done ? 'Paused · ' : ''}
            {pct}% Complete
          </StatusBadge>
        </div>

        <ProgressBar value={pct} label="Overall sync progress" />

        <div className="divide-y divide-light-outline-variant border border-light-outline-variant rounded-md">
          {tables.map((t) => {
            const tablePct = Math.floor((t.processedRows / t.rows) * 100)
            return (
              <div key={t.name} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-mono-sm text-light-on-surface">{t.name}</p>
                  <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                    {formatNumber(t.processedRows)} / {formatNumber(t.rows)} rows
                  </p>
                </div>
                {tablePct >= 100 ? (
                  <StatusBadge tone="success">Completed</StatusBadge>
                ) : t.processedRows === 0 ? (
                  <StatusBadge tone="neutral">Queued</StatusBadge>
                ) : (
                  <StatusBadge tone="primary">{tablePct}%</StatusBadge>
                )}
              </div>
            )
          })}
        </div>

        <footer className="pt-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={runInBackground} className={btnBack}>
            Run in background
          </button>
          <div className="flex items-center gap-2">
            {!done && (
              <button type="button" onClick={togglePause} className={btnSecondary}>
                {paused ? 'Resume sync' : 'Pause sync'}
              </button>
            )}
            <button type="button" onClick={viewResults} disabled={!done} className={btnPrimary}>
              View results
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
