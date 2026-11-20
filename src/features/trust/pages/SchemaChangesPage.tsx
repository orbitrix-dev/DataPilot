import { usePageChrome } from '../../../components/layout/ShellContext'
import { StatusBadge } from '../../connect/components/StatusBadge'
import { formatShortUtc } from '../../connect/format'
import { schemaChanges } from '../data'

/** Schema change monitoring (designed: trust_schema_change_monitoring). */
export function SchemaChangesPage() {
  usePageChrome([{ label: 'Trust', to: '/trust' }, { label: 'Schema changes' }])

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      <div>
        <h1 className="font-headline text-headline-lg text-light-on-surface">Schema change monitoring</h1>
        <p className="font-body text-body-md text-light-on-surface-variant mt-1">
          Tracks column additions, removals, and data-type changes before they break downstream reports.
        </p>
      </div>
      <section className="flex flex-col gap-4" aria-label="Detected schema changes">
        {schemaChanges.map((c) => (
          <article key={c.id} className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <StatusBadge tone={c.kind === 'breaking' ? 'error' : 'warning'}>
                  {c.kind === 'breaking' ? 'Breaking change' : 'Non-breaking change'}
                </StatusBadge>
                <span className="font-mono text-mono-sm text-light-on-surface">{c.dataset}</span>
              </div>
              <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                Detected {formatShortUtc(c.detected)}
              </span>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant">
                <span className="font-label text-label-sm uppercase text-light-on-surface-variant">For business users</span>
                <p className="font-body text-body-sm text-light-on-surface mt-1">
                  {c.businessSummary.before}
                  <code className="font-mono text-mono-sm">{c.businessSummary.field}</code>
                  {c.businessSummary.after}
                </p>
              </div>
              <div className="p-4 rounded bg-light-surface-container-low border border-light-outline-variant">
                <span className="font-label text-label-sm uppercase text-light-on-surface-variant">Technical evidence</span>
                <p className="font-mono text-mono-sm text-light-on-surface mt-1 break-words">{c.technical}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
