import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { KpiCard } from '../components/KpiCard'
import { StatusBadge } from '../components/StatusBadge'
import { healthKpis, slaEntries, type Kpi } from '../data'
import { useConnectState } from '../store'

/** Connection health & reliability (designed: connect_connection_health). */
export function ConnectionHealthPage() {
  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Connection health' }])
  const { connections } = useConnectState()

  const failed = connections.filter((c) => c.status === 'failed')
  const expiringKpi: Kpi = {
    label: 'Expiring credentials',
    value: String(failed.length),
    valueClassName: failed.length ? 'text-error' : 'text-light-on-surface',
    caption: failed.length ? `${failed[0].sourceType} key requires rotation` : 'All credentials valid',
    captionClassName: failed.length ? 'text-error' : 'text-success',
  }

  const rows = slaEntries.flatMap((entry) => {
    const c = connections.find((x) => x.id === entry.connectionId)
    return c ? [{ entry, connection: c }] : []
  })

  return (
    <>
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Connection health &amp; reliability</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          Real-time uptime, sync latency, and credential expiration monitoring.
        </p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        {[...healthKpis, expiringKpi].map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6">
        <h2 className="font-title text-title-lg text-light-on-surface mb-4">Connector SLA status</h2>
        <ul className="divide-y divide-light-outline-variant">
          {rows.map(({ entry, connection: c }) => (
            <li key={c.id} className="py-3.5 flex items-center justify-between gap-4">
              <div>
                <Link
                  to={`/connect/connections/${c.id}`}
                  className="font-title text-title-md text-light-on-surface hover:text-light-primary hover:underline"
                >
                  {c.name}
                </Link>
                <p className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                  {c.status !== 'failed' && entry.recoveredSummary ? entry.recoveredSummary : entry.summary}
                </p>
              </div>
              {c.status === 'failed' ? (
                <Link
                  to={`/connect/connections/${c.id}?rotate=1`}
                  className="px-3 py-1 rounded bg-error text-on-error font-label text-label-sm shrink-0"
                >
                  Rotate key
                </Link>
              ) : c.status === 'latency' ? (
                <StatusBadge tone="warning">Degraded</StatusBadge>
              ) : (
                <StatusBadge tone="success">Healthy</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
