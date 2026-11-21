import { useRef, useState, type FormEvent } from 'react'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Drawer } from '../../../components/ui/Drawer'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { when } from '../../command-center/activity'
import { AdminHeader, AdminPage, SettingsTabs } from '../components/parts'
import { dangerLinkClass, fieldClass, labelClass, panelClass, thClass } from '../styles'
import { scopes, type ApiKey } from '../data'
import { createKey, revokeKey, useAdminState } from '../store'

/** API Keys (designed: admin_api_keys). The design's "requires MFA in production" notice became a real create flow. */
export function ApiKeysPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'API Keys' }])
  const { keys } = useAdminState()
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const toast = useToast()
  const active = keys.filter((k) => !k.revoked)

  return (
    <AdminPage>
      <SettingsTabs />
      <AdminHeader
        title="API Keys"
        description="Secrets are hashed at creation and never displayed again. Only key prefixes are shown."
        actions={<Button onClick={() => setCreating(true)}>Create API Key</Button>}
      />

      <div className={cn(panelClass, 'overflow-x-auto')}>
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={thClass}>Name &amp; Prefix</th>
              <th className={thClass}>Scopes</th>
              <th className={thClass}>Created By</th>
              <th className={thClass}>Last Used</th>
              <th className={cn(thClass, 'text-right')}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {keys.map((k) => (
              <tr key={k.id} className={cn(k.revoked && 'opacity-60')}>
                <td className="px-4 py-3.5">
                  <p className="font-label text-label-md text-light-on-surface">{k.name}</p>
                  <p className="font-mono text-mono-sm text-light-on-surface-variant">{k.prefix}</p>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((sc) => (
                      <span key={sc} className="font-mono text-mono-sm text-light-on-surface px-1.5 rounded-sm bg-light-surface-container">
                        {sc}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface">
                  {k.createdBy}
                  <span className="block text-light-on-surface-variant">{k.created === 'Today' ? 'Created this session' : when(k.created).time.replace(/, \d\d:\d\d$/, '')}</span>
                </td>
                <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant whitespace-nowrap">{k.lastUsed ? when(k.lastUsed).time : 'Never used'}</td>
                <td className="px-4 py-3.5 text-right">
                  {k.revoked ? (
                    <span className="font-label text-label-md text-light-on-surface-variant">Revoked</span>
                  ) : (
                    <button type="button" className={dangerLinkClass} onClick={() => setRevoking(k)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-body text-body-sm text-light-on-surface-variant">
        {active.length} active {active.length === 1 ? 'key' : 'keys'}. Keys are read-only: no scope can trigger Automate actions or change Connect sources.
      </p>

      {creating && (
        <CreateKeyDrawer
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false)
            setSecret(s)
          }}
        />
      )}

      <Modal
        open={!!secret}
        onClose={() => setSecret(null)}
        title="Copy your new API key"
        description="This is the only time the full secret is shown. Store it in your secrets manager now."
        footer={
          <Button size="sm" onClick={() => setSecret(null)}>
            I’ve stored it
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 break-all font-mono text-mono-sm bg-light-surface-container-low border border-light-outline-variant rounded px-3 py-2">{secret}</code>
          <Button
            variant="secondary"
            size="sm"
            icon="content_copy"
            onClick={() => {
              if (!secret) return
              navigator.clipboard?.writeText(secret).then(
                () => toast('API key copied'),
                () => toast('Copy failed: select the key and copy it manually', 'error'),
              )
            }}
          >
            Copy
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking?.name}?`}
        description={`Requests using ${revoking?.prefix} will fail immediately. This cannot be undone; create a new key to restore access.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!revoking) return
                revokeKey(revoking.id)
                toast(`${revoking.name} revoked`, 'info')
                setRevoking(null)
              }}
            >
              Revoke key
            </Button>
          </>
        }
      />
    </AdminPage>
  )
}

type Errors = { name?: string; scopes?: string; code?: string }

function CreateKeyDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const { keys } = useAdminState()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const scopeRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim()
    const next: Errors = {
      name: !n ? 'Name the key after the service that will use it.' : keys.some((k) => !k.revoked && k.name.toLowerCase() === n.toLowerCase()) ? 'An active key already has this name.' : undefined,
      scopes: picked.length ? undefined : 'Select at least one scope.',
      code: /^\d{6}$/.test(code) ? undefined : 'Enter the 6-digit code from your authenticator app.',
    }
    setErrors(next)
    if (next.name) return nameRef.current?.focus()
    if (next.scopes) return scopeRef.current?.focus()
    if (next.code) return codeRef.current?.focus()
    setBusy(true)
    window.setTimeout(() => onCreated(createKey(n, picked)), 700)
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Create API key"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} disabled={busy}>
            {busy ? 'Verifying…' : 'Create key'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div>
          <label htmlFor="key-name" className={labelClass}>
            Key name
          </label>
          <input
            ref={nameRef}
            id="key-name"
            type="text"
            placeholder="e.g. Finance Data Warehouse Sync"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'key-name-error' : undefined}
            className={cn(fieldClass, errors.name ? 'border-error' : 'border-light-outline')}
          />
          {errors.name && (
            <p id="key-name-error" role="alert" className="font-body text-body-sm text-error mt-1.5">
              {errors.name}
            </p>
          )}
        </div>
        <fieldset aria-describedby={errors.scopes ? 'key-scopes-error' : undefined}>
          <legend className={labelClass}>Scopes (read-only)</legend>
          <div className="flex flex-col gap-2">
            {scopes.map((sc, i) => (
              <label key={sc.id} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  ref={i === 0 ? scopeRef : undefined}
                  type="checkbox"
                  checked={picked.includes(sc.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, sc.id] : picked.filter((p) => p !== sc.id))}
                  className="mt-0.5 rounded text-light-primary focus:ring-light-primary"
                />
                <span>
                  <span className="block font-mono text-mono-sm text-light-on-surface">{sc.id}</span>
                  <span className="block font-body text-body-sm text-light-on-surface-variant">{sc.label}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.scopes && (
            <p id="key-scopes-error" role="alert" className="font-body text-body-sm text-error mt-1.5">
              {errors.scopes}
            </p>
          )}
        </fieldset>
        <div>
          <label htmlFor="key-mfa" className={labelClass}>
            Confirm with MFA
          </label>
          <input
            ref={codeRef}
            id="key-mfa"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? 'key-mfa-error' : 'key-mfa-hint'}
            className={cn(fieldClass, 'font-mono tracking-widest', errors.code ? 'border-error' : 'border-light-outline')}
          />
          {errors.code ? (
            <p id="key-mfa-error" role="alert" className="font-body text-body-sm text-error mt-1.5">
              {errors.code}
            </p>
          ) : (
            <p id="key-mfa-hint" className="font-body text-body-sm text-light-on-surface-variant mt-1.5">
              Any 6 digits work in this preview. The event is logged to Audit Logs.
            </p>
          )}
        </div>
      </form>
    </Drawer>
  )
}
