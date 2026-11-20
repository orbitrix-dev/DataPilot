import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { IncidentNotFound } from '../components/IncidentNotFound'
import type { CauseStep } from '../data'
import { useTrustState } from '../store'

const stepStyle: Record<CauseStep['tone'], { box: string; label: string }> = {
  warning: { box: 'border-warning bg-warning-container/30', label: 'text-on-warning-container' },
  error: { box: 'border-error bg-error-container/30', label: 'text-on-error-container' },
  neutral: { box: 'border-light-outline-variant bg-light-surface-container-low', label: 'text-light-on-surface-variant' },
}

/** Root cause analysis (designed: trust_root_cause_analysis, for INC-204). */
export function RootCausePage() {
  const { incidentId } = useParams()
  const { incidents } = useTrustState()
  const incident = incidents.find((i) => i.id === incidentId)
  usePageChrome([
    { label: 'Trust', to: '/trust' },
    { label: 'Incidents', to: '/trust/incidents' },
    ...(incident ? [{ label: incident.id, to: `/trust/incidents/${incident.id}` }] : []),
    { label: 'Root cause analysis' },
  ])

  if (!incident) return <IncidentNotFound id={incidentId} />

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Root cause analysis — {incident.id}</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">{incident.rcaSubtitle}</p>
        </div>
        <Link
          to={`/trust/incidents/${incident.id}`}
          className="font-label text-label-md text-light-primary hover:underline shrink-0"
        >
          Back to incident
        </Link>
      </div>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6">
        <h2 className="font-title text-title-md text-light-on-surface mb-4">Event causal chain</h2>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {incident.causalChain.map((s) => (
            <li key={s.label} className={cn('p-4 rounded border', stepStyle[s.tone].box)}>
              <span className={cn('font-label text-label-sm tabular-nums', stepStyle[s.tone].label)}>{s.label}</span>
              <p className="font-title text-title-md text-light-on-surface mt-1">{s.title}</p>
              <p className="font-body text-body-sm text-light-on-surface-variant mt-1">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
