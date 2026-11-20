import { useEffect, useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { StepPanel } from '../components/StepPanel'
import { dataSourceOption } from '../options'
import { useWizard } from '../wizardState'

const TICK_MS = 120
const TICK_PCT = 3

/** Simulated initial scan: advances to 100% then marks the wizard's scan as complete. */
function useScanProgress(alreadyComplete: boolean, onComplete: () => void) {
  const [progress, setProgress] = useState(alreadyComplete ? 100 : 0)

  useEffect(() => {
    if (progress >= 100) return
    const t = window.setTimeout(() => setProgress((p) => Math.min(100, p + TICK_PCT)), TICK_MS)
    return () => window.clearTimeout(t)
  }, [progress])

  useEffect(() => {
    if (progress >= 100 && !alreadyComplete) onComplete()
  }, [progress, alreadyComplete, onComplete])

  return progress
}

export function DataScanStep() {
  const { answers, update } = useWizard()
  const source = dataSourceOption(answers.dataSource)
  const progress = useScanProgress(answers.scanComplete, () => update({ scanComplete: true }))
  const done = progress >= 100

  return (
    <StepPanel
      title="Scanning your initial data"
      description={`We are checking your ${source.scanName} records for completeness and reliability.`}
    >
      <div className="flex flex-col gap-3" aria-live="polite">
        <ScanRow status="done" icon="check_circle" label="Secure connection established" badge="Verified" />

        {done ? (
          <ScanRow status="done" icon="check_circle" label="Reading invoices, customers, and inventory" badge="Complete" />
        ) : (
          <div className="p-4 rounded bg-light-surface border border-light-primary flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon name="sync" size={20} className="text-light-primary animate-spin [animation-duration:2s]" />
                <span className="font-label text-label-lg text-light-on-surface">Reading invoices, customers, and inventory</span>
              </div>
              <span className="font-label text-label-md text-light-primary tabular-nums">{progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Reading records"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1.5 w-full rounded-full bg-light-surface-container overflow-hidden"
            >
              <div
                className="h-full bg-light-primary rounded-full transition-[width] duration-state-change ease-state-change"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {done ? (
          <ScanRow status="done" icon="check_circle" label="Building starting Command Center metrics" badge="Ready" />
        ) : (
          <ScanRow status="pending" icon="schedule" label="Building starting Command Center metrics" badge="Up next" />
        )}
      </div>
    </StepPanel>
  )
}

function ScanRow({
  status,
  icon,
  label,
  badge,
}: {
  status: 'done' | 'pending'
  icon: string
  label: string
  badge: string
}) {
  const isDone = status === 'done'
  return (
    <div
      className={cn(
        'p-4 rounded bg-light-surface-container-low border border-light-outline-variant flex items-center justify-between',
        !isDone && 'opacity-75',
      )}
    >
      <div className="flex items-center gap-3">
        <Icon name={icon} size={20} className={isDone ? 'text-success' : 'text-light-on-surface-variant'} />
        <span className={cn('font-label text-label-lg', isDone ? 'text-light-on-surface' : 'text-light-on-surface-variant')}>
          {label}
        </span>
      </div>
      {isDone ? (
        <Badge tone="success">{badge}</Badge>
      ) : (
        <span className="font-label text-label-sm text-light-on-surface-variant">{badge}</span>
      )}
    </div>
  )
}
