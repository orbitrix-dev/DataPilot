import { useMemo } from 'react'
import { resources, statusFilters, statusTone, type Resource, type StatusFilter, type Tone } from '../data'

const statusPill: Record<Tone, { pill: string; dot: string }> = {
  success: { pill: 'bg-success-container text-on-success-container', dot: 'bg-success' },
  warning: { pill: 'bg-warning-container text-on-warning-container', dot: 'bg-warning' },
  error: { pill: 'bg-error-container text-on-error-container', dot: 'bg-error' },
}

export function ResourceTable({
  query,
  onQueryChange,
  status,
  onStatusChange,
  selectedId,
  onSelect,
  onExport,
  onResetFilters,
}: {
  query: string
  onQueryChange: (q: string) => void
  status: StatusFilter
  onStatusChange: (s: StatusFilter) => void
  selectedId: string | null
  onSelect: (r: Resource) => void
  onExport: () => void
  onResetFilters: () => void
}) {
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return resources.filter(
      (r) =>
        (status === 'All' || r.status === status) &&
        (!q || r.id.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)),
    )
  }, [query, status])

  const cycleStatus = () => onStatusChange(statusFilters[(statusFilters.indexOf(status) + 1) % statusFilters.length])

  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
      <div className="p-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-gutter-md">
        <div className="flex flex-wrap items-center gap-gutter-sm">
          <div className="relative">
            <span
              className="material-symbols-outlined text-[18px] text-light-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            >
              search
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Filter records..."
              aria-label="Filter records"
              className="pl-9 pr-3 py-1.5 rounded border border-light-outline bg-light-surface text-body-sm text-light-on-surface placeholder:text-light-on-surface-variant focus:border-light-primary focus:ring-1 focus:ring-light-primary w-60"
            />
          </div>
          <button
            type="button"
            onClick={cycleStatus}
            title="Cycle status filter"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container"
          >
            <span className="material-symbols-outlined text-[16px] text-light-on-surface-variant" aria-hidden="true">
              filter_list
            </span>
            <span className="font-label text-label-md">Status: {status}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container"
        >
          <span className="font-label text-label-md">Export CSV</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-light-surface-container border-b border-light-outline-variant">
            <tr>
              <th scope="col" className="px-4 py-3 text-light-on-surface-variant">
                <span className="font-label text-label-md">Resource ID</span>
              </th>
              <th scope="col" className="px-4 py-3 text-light-on-surface-variant">
                <span className="font-label text-label-md">Category</span>
              </th>
              <th scope="col" className="px-4 py-3 text-light-on-surface">
                <span className="font-label text-label-md">Status</span>
              </th>
              <th scope="col" className="px-4 py-3 text-light-on-surface-variant text-right">
                <span className="font-label text-label-md">Latency</span>
              </th>
              <th scope="col" className="px-4 py-3 text-light-on-surface-variant text-right">
                <span className="font-label text-label-md">Updated</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {rows.map((r) => {
              const tone = statusPill[statusTone[r.status]]
              const selected = r.id === selectedId
              return (
                <tr
                  key={r.id}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelect(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(r)
                    }
                  }}
                  className={`hover:bg-light-surface-container-low cursor-pointer focus-visible:outline-none focus-visible:bg-light-surface-container-low ${selected ? 'bg-light-surface-container-low' : ''}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-mono-sm text-light-on-surface">{r.id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-body text-body-md text-light-on-surface-variant">{r.category}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm ${tone.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                      <span className="font-label text-label-sm">{r.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-body text-body-md tabular-nums">{r.latency}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">{r.updated}</span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <p className="font-body text-body-sm text-light-on-surface-variant">No items match your active filters.</p>
                  <button
                    type="button"
                    onClick={onResetFilters}
                    className="mt-2 px-3 py-1.5 rounded border border-light-outline text-light-on-surface hover:bg-light-surface-container font-label text-label-md"
                  >
                    Reset filters
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
