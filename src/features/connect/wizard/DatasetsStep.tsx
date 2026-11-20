import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import type { SourceDataset } from '../data'
import { formatNumber } from '../format'
import { btnBack, btnPrimary } from '../styles'
import { useWizard, type SyncMode } from './context'

/** Step 5 — Select datasets (extrapolated): review discovered schema and pick a sync mode per table. */
export function DatasetsStep() {
  const { selectedDatasets, modes, setMode, goTo } = useWizard()
  const totalRows = selectedDatasets.reduce((s, d) => s + d.rows, 0)

  const columns: Column<SourceDataset>[] = [
    { key: 'name', header: 'Table name', cellClassName: 'font-mono text-mono-sm text-light-on-surface', cell: (d) => d.name },
    {
      key: 'columns',
      header: 'Columns',
      align: 'right',
      cellClassName: 'font-body text-body-md tabular-nums',
      cell: (d) => d.columns,
    },
    { key: 'pk', header: 'Primary key', cellClassName: 'font-mono text-mono-sm', cell: (d) => d.primaryKey },
    {
      key: 'mode',
      header: 'Sync mode',
      cell: (d) => {
        const mode = modes[d.name] ?? 'incremental'
        return (
          <select
            value={mode}
            onChange={(e) => setMode(d.name, e.target.value as SyncMode)}
            aria-label={`Sync mode for ${d.name}`}
            className="pl-3 pr-8 py-1.5 rounded border border-light-outline bg-light-surface text-body-sm"
          >
            <option value="incremental">Incremental · {d.cursor}</option>
            <option value="full">Full refresh</option>
          </select>
        )
      },
    },
    {
      key: 'rows',
      header: 'Estimated rows',
      align: 'right',
      cellClassName: 'font-body text-body-md tabular-nums',
      cell: (d) => formatNumber(d.rows),
    },
  ]

  return (
    <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
      <header className="px-6 py-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-headline-md text-light-on-surface">Review selected datasets</h1>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Schemas were discovered during testing. Incremental syncs read only rows changed since the last run.
          </p>
        </div>
        <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
          {selectedDatasets.length} tables · {formatNumber(totalRows)} rows
        </span>
      </header>
      <DataTable
        columns={columns}
        rows={selectedDatasets}
        rowKey={(d) => d.name}
        hover={false}
        empty={
          <EmptyState icon="table_rows" title="No datasets selected">
            Go back to Configure access and choose at least one table.
          </EmptyState>
        }
      />
      <footer className="px-6 py-4 bg-light-surface-container-low border-t border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => goTo('access')} className={btnBack}>
          Change tables
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goTo('test')} className={btnBack}>
            Back
          </button>
          <button type="button" onClick={() => goTo('sync')} disabled={selectedDatasets.length === 0} className={btnPrimary}>
            Run initial sync
          </button>
        </div>
      </footer>
    </section>
  )
}
