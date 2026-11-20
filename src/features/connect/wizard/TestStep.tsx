import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../components/StatusBadge'
import { formatNumber } from '../format'
import { btnBack, btnPrimary, btnSecondary } from '../styles'
import { useWizard } from './context'

const CHECK_INTERVAL_MS = 750

/** Step 4 — Test connection (designed: connect_connection_testing). Checks run on a timer. */
export function TestStep() {
  const { preset, form, selectedDatasets, goTo } = useWizard()
  const toast = useToast()
  const [completed, setCompleted] = useState(0)
  const [runId, setRunId] = useState(0)

  const estimated = selectedDatasets.reduce((s, d) => s + d.rows, 0)
  const endpoint = preset.sourceId === 's3' ? form.host : `${form.host}:${form.port}`

  const checks: Array<{ title: string; detail: ReactNode; tabular?: boolean }> = [
    { title: 'Network & TLS 1.3 encryption', detail: `Connected to ${endpoint} in 38 ms`, tabular: true },
    {
      title: 'Read-only role verification',
      detail: (
        <>
          Confirmed <code className="font-mono text-mono-sm">{form.username}</code> has SELECT-only privileges
        </>
      ),
    },
    { title: 'Write access denied', detail: 'INSERT, UPDATE and DELETE probes were rejected by the source' },
    {
      title: 'Dataset schema discovery',
      detail: `${selectedDatasets.length} selected tables · ${formatNumber(estimated)} estimated records`,
      tabular: true,
    },
  ]
  const total = checks.length
  const passed = completed >= total

  useEffect(() => {
    const timers = Array.from({ length: total }, (_, i) =>
      window.setTimeout(() => setCompleted(i + 1), (i + 1) * CHECK_INTERVAL_MS),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [runId, total])

  useEffect(() => {
    if (passed) toast(`Connection test passed — ${total} of ${total} checks verified`)
  }, [passed, total, toast])

  const rerun = () => {
    setCompleted(0)
    setRunId((r) => r + 1)
  }

  return (
    <div className="max-w-3xl w-full mx-auto">
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-lg">
        <div className="flex items-start justify-between gap-4">
          <div aria-live="polite">
            <h1 className="font-headline text-headline-lg text-light-on-surface">
              {passed ? 'Connection test passed' : 'Testing connection…'}
            </h1>
            <p className="font-body text-body-md text-light-on-surface-variant mt-1">
              {passed
                ? `${form.name} passed all ${total} security and read-only checks.`
                : `Running ${total} security and read-only checks against ${form.name}.`}
            </p>
          </div>
          <StatusBadge tone={passed ? 'success' : 'primary'} size="md">
            {completed} / {total} Passed
          </StatusBadge>
        </div>

        <ul className="flex flex-col gap-3">
          {checks.map((c, i) => {
            const state = i < completed ? 'passed' : i === completed ? 'running' : 'queued'
            return (
              <li
                key={c.title}
                className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  {state === 'passed' && <Icon name="check_circle" size={20} className="text-success" />}
                  {state === 'running' && <Icon name="progress_activity" size={20} className="text-light-primary animate-spin" />}
                  {state === 'queued' && <Icon name="radio_button_unchecked" size={20} className="text-light-on-surface-variant" />}
                  <div>
                    <p className="font-label text-label-lg text-light-on-surface">{c.title}</p>
                    <p className={cn('font-body text-body-sm text-light-on-surface-variant', c.tabular && 'tabular-nums')}>
                      {state === 'passed' ? c.detail : state === 'running' ? 'Checking…' : 'Queued'}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    'font-label text-label-sm shrink-0',
                    state === 'passed' ? 'text-success' : state === 'running' ? 'text-light-primary' : 'text-light-on-surface-variant',
                  )}
                >
                  {state === 'passed' ? 'Verified' : state === 'running' ? 'Running' : 'Pending'}
                </span>
              </li>
            )
          })}
        </ul>

        <footer className="pt-4 border-t border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => goTo('access')} className={btnBack}>
            Back
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={rerun} disabled={!passed} className={btnSecondary}>
              Re-run test
            </button>
            <button type="button" onClick={() => goTo('datasets')} disabled={!passed} className={btnPrimary}>
              Review datasets
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
