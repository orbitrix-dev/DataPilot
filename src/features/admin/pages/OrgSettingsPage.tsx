import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { AdminHeader, AdminPage, SavedNotice, SettingsTabs } from '../components/parts'
import { fieldClass, labelClass, panelClass } from '../styles'
import { industries, retentions, roleById, timezones, type OrgSettings } from '../data'
import { canManageBilling, cancelDeletion, me, owner, saveOrg, scheduleDeletion, useAdminState } from '../store'

/** Organization Settings (designed: admin_organization_settings). */
export function OrgSettingsPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Organization Settings' }])
  const s = useAdminState()
  const [draft, setDraft] = useState<OrgSettings>(s.org)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const dirty = (Object.keys(draft) as (keyof OrgSettings)[]).some((k) => draft[k] !== s.org[k])
  const allowed = canManageBilling(s)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const name = draft.name.trim()
    if (!name) {
      setError('Enter the organization name.')
      nameRef.current?.focus()
      return
    }
    const n = saveOrg({ ...draft, name })
    setDraft({ ...draft, name })
    setSaved(true)
    toast(n ? 'Organization settings saved' : 'No changes to save', n ? 'success' : 'info')
  }

  const select = (id: keyof OrgSettings, label: string, options: string[], hint?: string) => (
    <div>
      <label htmlFor={`org-${id}`} className={labelClass}>
        {label}
      </label>
      <select
        id={`org-${id}`}
        value={draft[id]}
        onChange={(e) => {
          setDraft({ ...draft, [id]: e.target.value })
          setSaved(false)
        }}
        className={cn(fieldClass, 'border-light-outline')}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      {hint && <p className="font-body text-body-sm text-light-on-surface-variant mt-1.5">{hint}</p>}
    </div>
  )

  return (
    <AdminPage width="4xl">
      <SettingsTabs />
      <AdminHeader
        title="Organization Settings"
        description="Manage workspace profile, fiscal calendar, and data retention policies. All changes are recorded in Audit Logs."
      />

      {s.deletionScheduled && (
        <div role="alert" className="bg-error-container border border-error rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="font-body text-body-sm text-on-error-container">
            {s.org.name} is scheduled for permanent deletion on {s.deletionScheduled}. Data stays available until then.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              cancelDeletion()
              toast('Workspace deletion cancelled')
            }}
          >
            Cancel deletion
          </Button>
        </div>
      )}

      <form onSubmit={submit} noValidate className={cn(panelClass, 'p-6 flex flex-col gap-5')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="org-name" className={labelClass}>
              Organization Name
            </label>
            <input
              ref={nameRef}
              id="org-name"
              type="text"
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value })
                setSaved(false)
                setError('')
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'org-name-error' : undefined}
              className={cn(fieldClass, error ? 'border-error' : 'border-light-outline')}
            />
            {error && (
              <p id="org-name-error" role="alert" className="font-body text-body-sm text-error mt-1.5">
                {error}
              </p>
            )}
          </div>
          {select('industry', 'Primary Industry', industries)}
          {select('timezone', 'Reporting Timezone', timezones, 'Trust, Automate and the Command Center show times in UTC today.')}
          {select('retention', 'Audit Log Retention', retentions)}
        </div>
        <div className="flex justify-end pt-4 border-t border-light-outline-variant">
          <Button type="submit" disabled={!dirty}>
            Save Organization Settings
          </Button>
        </div>
      </form>
      {saved && !dirty && <SavedNotice>Organization settings saved and logged to Audit Logs.</SavedNotice>}

      <section className="bg-light-surface border border-error rounded-md p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-title-md text-error">Delete Organization</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
            Permanently removes all connections, Trust history, and reports. Requires Owner confirmation.
          </p>
          {!allowed && (
            <p className="font-body text-body-sm text-light-on-surface-variant mt-2">
              Only the {roleById('owner').label} ({owner(s).name}) can delete this workspace. Your role, {roleById(me(s).role).label}, has “None” for{' '}
              <Link to="/users-permissions/permissions" className="text-light-primary hover:underline">
                Billing &amp; workspace deletion
              </Link>
              .
            </p>
          )}
        </div>
        <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={!allowed || !!s.deletionScheduled} className="shrink-0 self-start sm:self-auto">
          Delete Workspace
        </Button>
      </section>

      {deleteOpen && <DeleteModal name={s.org.name} onClose={() => setDeleteOpen(false)} />}
    </AdminPage>
  )
}

function DeleteModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const toast = useToast()
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete this workspace?"
      description="Deletion is scheduled 7 days out and can be cancelled until then. After that, connections, Trust history and reports are removed permanently."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={typed !== name}
            onClick={() => {
              scheduleDeletion()
              toast('Workspace scheduled for deletion on Nov 27', 'warning')
              onClose()
            }}
          >
            Schedule deletion
          </Button>
        </>
      }
    >
      <label htmlFor="confirm-name" className={labelClass}>
        Type <strong>{name}</strong> to confirm
      </label>
      <input id="confirm-name" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={cn(fieldClass, 'border-light-outline')} />
    </Modal>
  )
}
