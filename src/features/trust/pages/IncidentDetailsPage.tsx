import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { formatLongUtc } from '../../connect/format'
import { btnPrimary } from '../../connect/styles'
import { useTimers } from '../../connect/useTimers'
import { IncidentNotFound } from '../components/IncidentNotFound'
import type { Incident } from '../data'
import { severityMeta } from '../status'
import { resolveIncident, useTrustState } from '../store'

const currentStatus: Record<Incident['status'], { label: string; className: string }> = {
  investigating: { label: 'Investigating (Active)', className: 'text-error' },
  acknowledged: { label: 'Acknowledged (Active)', className: 'text-warning' },
  resolved: { label: 'Resolved (Verified fixed)', className: 'text-success' },
}

/** Incident details (designed: trust_incident_details, for INC-204). */
export function IncidentDetailsPage() {
  const { incidentId } = useParams()
  const { incidents } = useTrustState()
  const incident = incidents.find((i) => i.id === incidentId)
  usePageChrome([
    { label: 'Trust', to: '/trust' },
    { label: 'Incidents', to: '/trust/incidents' },
    { label: incident?.id ?? 'Not found' },
  ])
  const toast = useToast()
  const schedule = useTimers()
  const [resolving, setResolving] = useState(false)

  if (!incident) return <IncidentNotFound id={incidentId} />

  const resolved = incident.status === 'resolved'
  const sev = severityMeta(incident)

  const resolve = () => {
    setResolving(true)
    schedule(() => {
      setResolving(false)
      resolveIncident(incident.id, '14:32 UTC')
      toast(`${incident.id} marked resolved`)
    }, 900)
  }

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5 mb-1">
            <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>
            <span className="font-mono text-mono-sm text-light-on-surface-variant">{incident.id}</span>
            <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
              First detected: {formatLongUtc(incident.firstDetected)}
            </span>
          </div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">{incident.headline}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/trust/incidents/${incident.id}/root-cause`}
            className="px-3.5 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-lg"
          >
            Root cause analysis
          </Link>
          {!resolved && (
            <button type="button" onClick={resolve} disabled={resolving} className={cn(btnPrimary, 'px-4')}>
              {resolving ? 'Resolving…' : 'Mark resolved'}
            </button>
          )}
        </div>
      </div>

      {/* Metadata strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        <div className="bg-light-surface border border-light-outline-variant rounded-md p-4">
          <span className="font-label text-label-sm text-light-on-surface-variant">Affected dataset</span>
          <p className="font-mono text-mono-sm text-light-on-surface mt-1">{incident.dataset}</p>
        </div>
        <div className="bg-light-surface border border-light-outline-variant rounded-md p-4">
          <span className="font-label text-label-sm text-light-on-surface-variant">Current status</span>
          <p className={cn('font-title text-title-md mt-1', currentStatus[incident.status].className)} aria-live="polite">
            {currentStatus[incident.status].label}
          </p>
        </div>
        <div className="bg-light-surface border border-light-outline-variant rounded-md p-4">
          <span className="font-label text-label-sm text-light-on-surface-variant">Downstream impact</span>
          <p className="font-title text-title-md text-light-on-surface mt-1">
            <Link to="/trust/impact" className="text-light-primary hover:underline">
              {incident.impactLabel}
            </Link>
          </p>
        </div>
      </section>

      {/* Business summary + technical evidence */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter-md">
        <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Probable root cause (Business summary)</h2>
          <p className="font-body text-body-md text-light-on-surface-variant text-pretty">{incident.businessCause}</p>
          <h3 className="font-title text-title-md text-light-on-surface pt-2">Recommended resolution</h3>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            {incident.resolution.text}
            {incident.resolution.code && <code className="font-mono text-mono-sm">{incident.resolution.code}</code>}
            {incident.resolution.after}
          </p>
        </article>
        <article className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-3">
          <h2 className="font-title text-title-md text-light-on-surface">Supporting evidence (Technical)</h2>
          <pre className="p-3 rounded bg-light-surface-container font-mono text-mono-sm text-light-on-surface overflow-x-auto whitespace-pre">
            {incident.evidence.join('\n')}
          </pre>
          <h3 className="font-title text-title-md text-light-on-surface pt-2">Incident history</h3>
          <ul className="text-body-sm font-body text-light-on-surface-variant flex flex-col gap-1 tabular-nums">
            {incident.history.map((h) => (
              <li key={h.time + h.text}>
                {h.time} — {h.text}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  )
}
