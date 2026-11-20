import { useEffect, useRef } from 'react'
import { DataTable, type Column } from '../components/DataTable'
import { StatusBadge } from '../components/StatusBadge'
import { lookbackOptions, syncScheduleOptions, type SourceDataset } from '../data'
import { formatNumber } from '../format'
import { btnBack, btnPrimary } from '../styles'
import { useWizard } from './context'

/** Step 3 — Configure access (designed: connect_connection_configuration). */
export function AccessStep() {
  const { preset, form, setField, selected, toggleDataset, setAllDatasets, goTo } = useWizard()
  const allRef = useRef<HTMLInputElement>(null)
  const total = preset.datasets.length
  const allChecked = selected.length === total
  const someChecked = selected.length > 0 && !allChecked

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked
  }, [someChecked])

  const columns: Column<SourceDataset>[] = [
    {
      key: 'select',
      className: 'w-10',
      header: (
        <input
          ref={allRef}
          type="checkbox"
          checked={allChecked}
          onChange={(e) => setAllDatasets(e.target.checked)}
          aria-label="Select all"
          className="rounded-sm border-light-outline text-light-primary"
        />
      ),
      cell: (d) => (
        <input
          type="checkbox"
          checked={selected.includes(d.name)}
          onChange={() => toggleDataset(d.name)}
          aria-label={`Sync ${d.name}`}
          className="rounded-sm border-light-outline text-light-primary"
        />
      ),
    },
    { key: 'name', header: 'Table name', cellClassName: 'font-mono text-mono-sm', cell: (d) => d.name },
    {
      key: 'rows',
      header: 'Estimated rows',
      align: 'right',
      cellClassName: 'font-body text-body-md tabular-nums',
      cell: (d) => formatNumber(d.rows),
    },
  ]

  return (
    <div className="flex flex-col gap-section">
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-headline-md text-light-on-surface">Access &amp; sync configuration</h1>
            <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
              Read-only access is enforced by default to protect your source systems.
            </p>
          </div>
          <StatusBadge tone="success" size="md">
            Read-only default
          </StatusBadge>
        </div>

        <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-gutter-md">
          <legend className="sr-only">Access level</legend>
          <label className="p-4 rounded border border-light-primary bg-light-primary-container/30 flex items-start gap-3">
            <input type="radio" name="access" defaultChecked className="mt-1 text-light-primary focus:ring-light-primary" />
            <div>
              <p className="font-label text-label-lg text-light-on-surface">Read-only access (Recommended)</p>
              <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
                Selects rows only. Never modifies, locks, or writes to source tables.
              </p>
            </div>
          </label>
          <label className="p-4 rounded border border-light-outline-variant bg-light-surface-container-low flex items-center gap-3">
            <input type="radio" name="access" disabled className="mt-1 text-light-primary" />
            <div>
              <p className="font-label text-label-lg text-light-on-surface">Managed write-back</p>
              <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
                Disabled in Connect. Controlled separately in Automate.
              </p>
            </div>
          </label>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-md pt-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">Sync schedule</span>
            <select
              value={form.schedule}
              onChange={(e) => setField('schedule', e.target.value)}
              className="px-3 py-2 rounded border border-light-outline bg-light-surface text-body-md"
            >
              {syncScheduleOptions.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">Historical lookback window</span>
            <select
              value={form.lookback}
              onChange={(e) => setField('lookback', e.target.value)}
              className="px-3 py-2 rounded border border-light-outline bg-light-surface text-body-md"
            >
              {lookbackOptions.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="bg-light-surface border border-light-outline-variant rounded-md overflow-hidden">
        <header className="px-6 py-4 border-b border-light-outline-variant flex items-center justify-between">
          <h2 className="font-title text-title-md text-light-on-surface">Select datasets to sync</h2>
          <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
            {selected.length} of {total} tables selected
          </span>
        </header>
        <DataTable columns={columns} rows={preset.datasets} rowKey={(d) => d.name} hover={false} />
        <footer className="px-6 py-4 bg-light-surface-container-low border-t border-light-outline-variant flex items-center justify-between">
          <button type="button" onClick={() => goTo('details')} className={btnBack}>
            Back
          </button>
          <button type="button" onClick={() => goTo('test')} disabled={selected.length === 0} className={btnPrimary}>
            Test connection
          </button>
        </footer>
      </section>
    </div>
  )
}
