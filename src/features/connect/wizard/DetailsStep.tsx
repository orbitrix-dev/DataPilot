import { useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { btnBack, btnPrimary, inputBase } from '../styles'
import { useWizard, type WizardForm } from './context'

type FieldDef = {
  key: keyof WizardForm
  label: string
  type?: 'text' | 'password'
  mono?: boolean
  className?: string
}

/** Step 2 — Connection details (designed: connect_database_connection_wizard). */
export function DetailsStep() {
  const { preset, form, setField, goTo } = useWizard()
  const [attempted, setAttempted] = useState(false)

  const fields: Record<string, FieldDef> = {
    name: { key: 'name', label: 'Connection name' },
    host: { key: 'host', label: preset.hostLabel, mono: true, className: 'sm:col-span-2' },
    port: { key: 'port', label: preset.sourceId === 's3' ? 'Region' : 'Port', mono: true },
    database: { key: 'database', label: preset.databaseLabel, mono: true },
    username: { key: 'username', label: preset.usernameLabel, mono: true },
    secret: { key: 'secret', label: preset.secretLabel, type: 'password' },
  }

  const missing = (Object.keys(fields) as Array<keyof WizardForm>).filter((k) => !form[k].trim())

  const renderField = (f: FieldDef) => {
    const invalid = attempted && !form[f.key].trim()
    const id = `wizard-${f.key}`
    return (
      <label key={f.key} htmlFor={id} className={cn('flex flex-col gap-1.5', f.className)}>
        <span className="font-label text-label-md text-light-on-surface">{f.label}</span>
        <input
          id={id}
          type={f.type ?? 'text'}
          value={form[f.key]}
          onChange={(e) => setField(f.key, e.target.value)}
          aria-invalid={invalid || undefined}
          autoComplete={f.type === 'password' ? 'new-password' : 'off'}
          className={cn(
            inputBase,
            f.mono ? 'font-mono text-mono-sm' : 'text-body-md',
            f.key === 'port' && 'tabular-nums',
            invalid && 'border-error',
          )}
        />
        {invalid && <span className="font-body text-body-sm text-error">{f.label} is required</span>}
      </label>
    )
  }

  const onContinue = () => {
    setAttempted(true)
    if (missing.length === 0) goTo('access')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter-lg items-start">
      <section className="lg:col-span-7 bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-gutter-md">
        <div>
          <h1 className="font-headline text-headline-md text-light-on-surface">Enter {preset.label} connection details</h1>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1">
            Credentials are encrypted at rest and never displayed in plain text.
          </p>
        </div>
        {renderField(fields.name)}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
          {renderField(fields.host)}
          {renderField(fields.port)}
        </div>
        {renderField(fields.database)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-md">
          {renderField(fields.username)}
          {renderField(fields.secret)}
        </div>
        <div className="pt-4 border-t border-light-outline-variant flex items-center justify-between">
          <button type="button" onClick={() => goTo('source')} className={btnBack}>
            Back
          </button>
          <button type="button" onClick={onContinue} className={btnPrimary}>
            Continue to Configure access
          </button>
        </div>
      </section>

      <aside className="lg:col-span-5 bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Icon name="lock" size={20} className="text-light-primary" />
          <h2 className="font-title text-title-md text-light-on-surface">Required permissions (Read-only)</h2>
        </div>
        <p className="font-body text-body-sm text-light-on-surface-variant text-pretty">
          For business owners: DataPilot only reads the tables you select. It cannot edit, delete, or write records back
          to your database.
        </p>
        <div className="p-3 rounded bg-light-surface-container font-mono text-mono-sm text-light-on-surface overflow-x-auto">
          {preset.grantSql.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </aside>
    </div>
  )
}
