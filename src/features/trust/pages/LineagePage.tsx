import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { cn } from '../../../lib/cn'
import { StatusBadge } from '../../connect/components/StatusBadge'
import type { StatusTone } from '../../connect/status'
import { isOpen } from '../status'
import { useTrustState } from '../store'

type Stage = {
  step: string
  name: string
  mono?: boolean
  tone: 'neutral' | 'warning' | 'error'
  badge?: { tone: StatusTone; label: string; to?: string }
  link?: { to: string; label: string }
}

const frame: Record<Stage['tone'], { box: string; label: string }> = {
  neutral: { box: 'border-light-outline bg-light-surface-container-low', label: 'text-light-on-surface-variant' },
  warning: { box: 'border-warning bg-warning-container/20', label: 'text-warning' },
  error: { box: 'border-error bg-error-container/20', label: 'text-error' },
}

/** Data lineage explorer (designed: trust_data_lineage_explorer). Node states follow INC-204. */
export function LineagePage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Lineage explorer' }])
  const { incidents } = useTrustState()
  const active = incidents.some((i) => i.id === 'INC-204' && isOpen(i))

  const stages: Stage[] = [
    { step: '1. Source', name: 'PostgreSQL ERP', tone: 'neutral', badge: { tone: 'success', label: 'Healthy' } },
    {
      step: '2. Dataset',
      name: 'public.invoices',
      mono: true,
      tone: active ? 'error' : 'neutral',
      badge: active
        ? { tone: 'error', label: 'INC-204 Active', to: '/trust/incidents/INC-204' }
        : { tone: 'success', label: 'Healthy' },
    },
    {
      step: '3. Transformation',
      name: 'stg_invoices_net',
      mono: true,
      tone: active ? 'warning' : 'neutral',
      badge: active ? { tone: 'warning', label: 'Review needed' } : { tone: 'success', label: 'Healthy' },
    },
    {
      step: '4. Business metric',
      name: 'Net Receivables ($)',
      tone: active ? 'warning' : 'neutral',
      badge: active ? { tone: 'warning', label: 'Potentially overstated' } : { tone: 'success', label: 'Verified' },
    },
    { step: '5. Dashboard', name: 'Finance Command', tone: 'neutral', link: { to: '/trust/impact', label: 'View impact →' } },
  ]

  return (
    <>
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Data lineage explorer</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          End-to-end flow from source system to business metrics and executive dashboards.
        </p>
      </div>
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 overflow-x-auto">
        <ol className="grid grid-cols-1 md:grid-cols-5 gap-4 md:min-w-[760px] items-stretch" aria-label="Lineage from source to dashboard">
          {stages.map((s) => (
            <li key={s.step} className={cn('p-4 rounded-md border flex flex-col gap-1.5', frame[s.tone].box)}>
              <span className={cn('font-label text-label-sm uppercase', frame[s.tone].label)}>{s.step}</span>
              <p className={s.mono ? 'font-mono text-mono-sm text-light-on-surface' : 'font-title text-title-md text-light-on-surface'}>
                {s.name}
              </p>
              {s.badge &&
                (s.badge.to ? (
                  <Link to={s.badge.to} className="w-fit hover:opacity-80">
                    <StatusBadge tone={s.badge.tone} compact>
                      {s.badge.label}
                    </StatusBadge>
                  </Link>
                ) : (
                  <StatusBadge tone={s.badge.tone} compact className="w-fit">
                    {s.badge.label}
                  </StatusBadge>
                ))}
              {s.link && (
                <Link to={s.link.to} className="font-label text-label-sm text-light-primary hover:underline">
                  {s.link.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
