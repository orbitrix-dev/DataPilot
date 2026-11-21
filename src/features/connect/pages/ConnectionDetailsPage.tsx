import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { StatusBadge } from '../components/StatusBadge'
import { NOW_ISO, formatLongUtc, formatNumber } from '../format'
import { connectionStatusMeta } from '../status'
import { recordRun, removeConnection, updateConnection, useConnectState } from '../store'
import { inputBase } from '../styles'
import { useTimers } from '../useTimers'

const headerBtn = 'px-3.5 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-lg'

/** Connection details (designed: connect_connection_details), with rotate + remove dialogs. */
export function ConnectionDetailsPage() {
  const { connectionId = '' } = useParams()
  const [params] = useSearchParams()
  const { connections } = useConnectState()
  const connection = connections.find((c) => c.id === connectionId)
  const navigate = useNavigate()
  const toast = useToast()
  const schedule = useTimers()

  usePageChrome([{ label: 'Connect', to: '/connect' }, { label: connection?.name ?? 'Connection not found' }])

  const [rotateOpen, setRotateOpen] = useState(() => params.get('rotate') === '1')
  const [newSecret, setNewSecret] = useState('')
  const [secretError, setSecretError] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  if (!connection) {
    return (
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6">
        <EmptyState icon="link_off" title="Connection not found">
          It may have been removed.{' '}
          <Link to="/connect" className="font-label text-label-md text-light-primary hover:underline">
            Back to Connect
          </Link>
        </EmptyState>
      </section>
    )
  }

  const status = connectionStatusMeta[connection.status]
  const isFile = connection.kind === 'file'
  const secretLabel = connection.credentials.find((c) => c.secret)?.label ?? 'Password / Secret'

  const closeRotate = () => {
    setRotateOpen(false)
    setNewSecret('')
    setSecretError(false)
  }

  const saveAndTest = () => {
    if (!newSecret.trim()) {
      setSecretError(true)
      return
    }
    setRotating(true)
    schedule(() => {
      setRotating(false)
      updateConnection(connection.id, {
        status: connection.status === 'failed' ? 'healthy' : connection.status,
        issue: undefined,
        rotated: { time: NOW_ISO, by: 'Elena Vance', at: Date.now() },
      })
      closeRotate()
      toast('Credentials rotated and verified — read-only access confirmed')
    }, 1200)
  }

  const syncNow = () => {
    setSyncing(true)
    schedule(() => {
      setSyncing(false)
      if (connection.status === 'failed') {
        recordRun({ connectionId: connection.id, source: connection.name, status: 'failed', statusLabel: 'Failed (403)', records: 0, durationSeconds: 2, timestamp: NOW_ISO, trigger: 'Manual' })
        toast('Sync failed (403) — rotate credentials and try again', 'error')
        return
      }
      const records = 14820
      recordRun({ connectionId: connection.id, source: connection.name, status: 'succeeded', records, durationSeconds: 42, timestamp: NOW_ISO, trigger: 'Manual' })
      updateConnection(connection.id, { lastSync: NOW_ISO })
      toast(`Sync completed — ${formatNumber(records)} records processed`)
    }, 2200)
  }

  const confirmRemove = () => {
    removeConnection(connection.id)
    setRemoveOpen(false)
    toast(`${connection.name} removed`, 'info')
    navigate('/connect')
  }

  const metrics = [
    { label: 'Last successful sync', value: formatLongUtc(connection.lastSync), className: 'text-light-on-surface tabular-nums' },
    { label: 'Records processed', value: connection.recordsLabel, className: 'text-light-on-surface tabular-nums' },
    { label: 'Access level', value: connection.accessLevel, className: 'text-success' },
  ]

  return (
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-section">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-headline text-headline-lg text-light-on-surface">{connection.name}</h1>
          <StatusBadge tone={status.tone} dot>
            {status.label}
          </StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/connect/health" className={headerBtn}>
            Health
          </Link>
          <Link to={`/connect/history?source=${connection.id}`} className={headerBtn}>
            Sync history
          </Link>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {connection.status === 'failed' && connection.issue && (
        <div role="alert" className="bg-light-surface border border-error rounded-md p-4 font-body text-body-sm text-light-on-surface-variant">
          <span className="font-label text-label-lg text-error">Sync failing · </span>
          {connection.issue}
        </div>
      )}

      {/* Metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter-md">
        {metrics.map((m) => (
          <div key={m.label} className="bg-light-surface border border-light-outline-variant rounded-md p-5">
            <span className="font-label text-label-md text-light-on-surface-variant">{m.label}</span>
            <p className={`font-title text-title-lg mt-1 ${m.className}`}>{m.value}</p>
          </div>
        ))}
      </section>

      {/* Credentials & security (never plain text) */}
      <section className="bg-light-surface border border-light-outline-variant rounded-md p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-title text-title-lg text-light-on-surface">Credentials &amp; rotation</h2>
            <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
              {isFile
                ? 'File uploads are stored as read-only copies and use no source credentials.'
                : 'Secrets are encrypted at rest and never displayed in plain text.'}
            </p>
          </div>
          {!isFile && (
            <button
              type="button"
              onClick={() => setRotateOpen(true)}
              className="px-4 py-2 rounded border border-light-outline bg-light-surface text-light-on-surface hover:bg-light-surface-container font-label text-label-lg"
            >
              Rotate credentials
            </button>
          )}
        </div>
        {connection.credentials.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-light-outline-variant">
            {connection.credentials.map((c) => (
              <div key={c.label}>
                <span className="font-label text-label-sm text-light-on-surface-variant">{c.label}</span>
                <p className="font-mono text-mono-sm text-light-on-surface mt-1">{c.value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section className="bg-light-surface border border-error rounded-md p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-title-md text-light-on-surface">Remove connection</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-0.5">
            Stops all scheduled syncs and revokes stored read-only credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRemoveOpen(true)}
          className="px-4 py-2 rounded bg-error text-on-error hover:opacity-90 font-label text-label-lg"
        >
          Remove connection
        </button>
      </section>

      <Modal
        open={rotateOpen}
        onClose={closeRotate}
        title="Rotate credentials"
        footer={
          <>
            <button
              type="button"
              onClick={closeRotate}
              className="px-4 py-2 rounded border border-light-outline bg-light-surface font-label text-label-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAndTest}
              disabled={rotating}
              className="px-4 py-2 rounded bg-light-primary text-light-on-primary font-label text-label-lg disabled:opacity-60"
            >
              {rotating ? 'Testing…' : 'Save & test'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4 py-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-label-md text-light-on-surface">
              {secretLabel === 'Password / Secret' ? 'New read-only password' : `New ${secretLabel.toLowerCase()}`}
            </span>
            <input
              type="password"
              value={newSecret}
              onChange={(e) => {
                setNewSecret(e.target.value)
                setSecretError(false)
              }}
              placeholder="Enter new password"
              autoComplete="new-password"
              aria-invalid={secretError || undefined}
              className={`${inputBase} text-body-md ${secretError ? 'border-error' : ''}`}
            />
            {secretError && <span className="font-body text-body-sm text-error">Enter a new secret to rotate</span>}
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={confirmRemove}
        title="Remove this connection?"
        cancelLabel="Keep connection"
        confirmLabel="Remove connection"
      >
        {connection.name} will stop syncing immediately. Existing validated datasets remain archived.
      </ConfirmDialog>
    </div>
  )
}
