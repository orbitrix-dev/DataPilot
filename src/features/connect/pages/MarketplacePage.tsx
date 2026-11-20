import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Icon } from '../../../components/ui/Icon'
import { EmptyState } from '../components/EmptyState'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import { dataSources, type DataSource } from '../data'

function SourceCard({ source, to }: { source: DataSource; to: string }) {
  return (
    <Link
      to={to}
      className="bg-light-surface border border-light-outline-variant hover:border-light-primary rounded-md p-5 flex flex-col justify-between gap-4 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded bg-light-primary-container text-light-on-primary-container flex items-center justify-center">
          <Icon name={source.icon ?? 'database'} size={22} />
        </div>
        <StatusBadge tone="success" compact>
          Available
        </StatusBadge>
      </div>
      <div>
        <h3 className="font-title text-title-md text-light-on-surface">{source.name}</h3>
        <p className="font-body text-body-sm text-light-on-surface-variant mt-1">{source.description}</p>
      </div>
    </Link>
  )
}

/** Data source marketplace (designed: connect_data_source_marketplace). */
export function MarketplacePage() {
  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: 'Add data source' }])
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const matches = q
    ? dataSources.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    : dataSources
  const files = matches.filter((s) => s.category === 'file')
  const databases = matches.filter((s) => s.category === 'database')
  const upcoming = matches.filter((s) => s.category === 'coming-soon')

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-lg text-light-on-surface">Choose a data source</h1>
          <p className="font-body text-body-md text-light-on-surface-variant mt-1">
            All supported connectors use encrypted, read-only access by default.
          </p>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search connectors..." label="Search connectors" size="md" />
      </div>

      {files.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-title text-title-lg text-light-on-surface">File sources</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter-md">
            {files.map((s) => (
              <SourceCard key={s.id} source={s} to="/connect/upload" />
            ))}
          </div>
        </section>
      )}

      {databases.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-title text-title-lg text-light-on-surface">Databases &amp; cloud platforms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter-md">
            {databases.map((s) => (
              <SourceCard key={s.id} source={s} to={`/connect/new/details?source=${s.id}`} />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-title text-title-lg text-light-on-surface">ERP &amp; CRM integrations (Coming soon)</h2>
            <span className="font-body text-body-sm text-light-on-surface-variant">In development — not yet active</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter-md">
            {upcoming.map((s) => (
              <div
                key={s.id}
                aria-disabled="true"
                className="bg-light-surface-container-low border border-light-outline-variant rounded-md p-5 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-title text-title-md text-light-on-surface">{s.name}</span>
                  <StatusBadge tone="neutral" compact>
                    Coming soon
                  </StatusBadge>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">{s.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {matches.length === 0 && (
        <section className="bg-light-surface border border-light-outline-variant rounded-md p-6">
          <EmptyState title={`No connectors match “${query.trim()}”`}>
            Try a product name such as PostgreSQL or Excel.{' '}
            <button type="button" onClick={() => setQuery('')} className="font-label text-label-md text-light-primary hover:underline">
              Clear search
            </button>
          </EmptyState>
        </section>
      )}
    </>
  )
}
