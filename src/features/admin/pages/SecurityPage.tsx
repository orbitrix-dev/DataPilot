import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { when } from '../../command-center/activity'
import { useConnectState } from '../../connect/store'
import { useAuditLog } from '../audit'
import { AdminHeader, AdminPage, CheckRow, SettingsTabs } from '../components/parts'
import { dangerLinkClass, fieldClass, labelClass, linkClass, panelClass } from '../styles'
import { ipAllowlist, sessionTimeouts, type SecurityPolicy, type Session } from '../data'
import { revokeSession, setPolicy, useAdminState } from '../store'

const weakening: Partial<Record<keyof SecurityPolicy, { title: string; body: string }>> = {
  requireMfa: {
    title: 'Stop requiring MFA?',
    body: 'Users without MFA, including anyone still pending enrollment, will be able to sign in with a password alone.',
  },
  enforceSso: {
    title: 'Stop enforcing SAML SSO?',
    body: 'Users will be able to sign in with a DataPilot password, bypassing Okta’s access policies and offboarding.',
  },
}

/** Security Settings (designed: admin_security_settings). */
export function SecurityPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Security Settings' }])
  const { policy, sessions, members } = useAdminState()
  const { connections } = useConnectState()
  const logins = useAuditLog().filter((r) => r.type === 'login').slice(0, 4)
  const [confirm, setConfirm] = useState<keyof SecurityPolicy | null>(null)
  const [revoking, setRevoking] = useState<Session | null>(null)
  const toast = useToast()

  const sources = connections.filter((c) => c.kind !== 'file')
  const readOnly = sources.every((c) => c.accessLevel.startsWith('Read-only'))
  const lastRotation = connections
    .filter((c) => c.rotated)
    .map((c) => ({ c, w: when(c.rotated!.time, c.rotated!.at) }))
    .sort((a, b) => b.w.sort - a.w.sort)[0]
  const pendingMfa = members.filter((m) => m.status === 'active' && m.mfa === 'pending')

  const toggle = (key: 'requireMfa' | 'enforceSso', on: boolean) => {
    if (!on) return setConfirm(key)
    setPolicy({ [key]: true })
    toast(key === 'requireMfa' ? 'MFA is now required for all users' : 'SAML SSO is now enforced')
  }

  return (
    <AdminPage>
      <SettingsTabs />
      <AdminHeader
        title="Security, Sessions & Access"
        description="Enforce MFA, review active sessions and login history, and inspect data connection access controls."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className={cn(panelClass, 'p-5 flex flex-col gap-2')}>
          <h2 className="font-title text-title-md text-light-on-surface">Authentication Policies</h2>
          <div className="divide-y divide-light-outline-variant">
            <CheckRow
              id="policy-mfa"
              label="Require MFA for all users"
              hint={
                policy.requireMfa && pendingMfa.length
                  ? `${pendingMfa.map((m) => m.name).join(', ')} cannot sign in until MFA is set up.`
                  : undefined
              }
              checked={policy.requireMfa}
              onChange={(v) => toggle('requireMfa', v)}
            />
            <CheckRow id="policy-sso" label="Enforce SAML SSO (Okta)" checked={policy.enforceSso} onChange={(v) => toggle('enforceSso', v)} />
          </div>
          <div className="pt-2">
            <label htmlFor="policy-timeout" className={labelClass}>
              Session timeout
            </label>
            <select
              id="policy-timeout"
              value={policy.sessionTimeout}
              onChange={(e) => {
                setPolicy({ sessionTimeout: e.target.value })
                toast(`Session timeout set to ${e.target.value}`)
              }}
              className={cn(fieldClass, 'border-light-outline py-1.5')}
            >
              {sessionTimeouts.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={cn(panelClass, 'p-5 flex flex-col gap-3')}>
          <h2 className="font-title text-title-md text-light-on-surface">Connection Access Information</h2>
          <p className="font-body text-body-sm text-light-on-surface-variant">
            {readOnly ? `All ${sources.length} active sources use read-only credentials` : `${sources.length} active sources`} encrypted at rest. Secrets are never displayed.
          </p>
          <div className="flex justify-between gap-4 py-2 border-t border-light-outline-variant">
            <span className="font-body text-body-sm text-light-on-surface-variant">IP Allowlist</span>
            <span className="font-label text-label-md text-light-on-surface text-right">
              {ipAllowlist.length} CIDR ranges
              {ipAllowlist.map((r) => (
                <span key={r.cidr} className="block font-mono text-mono-sm text-light-on-surface-variant" title={r.label}>
                  {r.cidr}
                </span>
              ))}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-2 border-t border-light-outline-variant">
            <span className="font-body text-body-sm text-light-on-surface-variant">Last Credential Rotation</span>
            {lastRotation ? (
              <Link to={`/connect/connections/${lastRotation.c.id}`} className={cn(linkClass, 'text-right')}>
                {lastRotation.w.time.replace(/, \d\d:\d\d$/, '')} ({lastRotation.c.sourceType})
              </Link>
            ) : (
              <span className="font-label text-label-md">—</span>
            )}
          </div>
          {connections.some((c) => c.status === 'failed') && (
            <p className="font-body text-body-sm text-warning">
              {connections
                .filter((c) => c.status === 'failed')
                .map((c) => c.name)
                .join(', ')}{' '}
              has an expired credential.{' '}
              <Link to="/connect/health" className="underline">
                Review in Connect
              </Link>
            </p>
          )}
        </section>
      </div>

      <section className={cn(panelClass, 'overflow-hidden')}>
        <div className="px-5 py-4 border-b border-light-outline-variant flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-title text-title-md text-light-on-surface">Active Sessions &amp; Recent Logins</h2>
          <Link to="/audit-logs?type=login" className={linkClass}>
            Full login history →
          </Link>
        </div>
        <div className="divide-y divide-light-outline-variant">
          {sessions.map((sess) => {
            const m = members.find((x) => x.id === sess.memberId)
            return (
              <div key={sess.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-label text-label-md text-light-on-surface">
                    {m?.name} · {sess.device} ({sess.location})
                  </p>
                  <p className="font-body text-body-sm text-light-on-surface-variant">
                    IP {sess.ip} · {sess.current ? 'Current session' : `Signed in ${when(sess.signedIn).time}`}
                  </p>
                </div>
                {sess.current ? (
                  <span className="px-2 py-0.5 rounded bg-success-container text-on-success-container font-label text-label-sm self-start sm:self-auto">Active Now</span>
                ) : (
                  <button type="button" className={cn(dangerLinkClass, 'self-start sm:self-auto')} onClick={() => setRevoking(sess)}>
                    Revoke Session
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {logins.length > 0 && (
          <div className="px-5 py-3 bg-light-surface-container-low border-t border-light-outline-variant">
            <p className="font-label text-label-sm uppercase text-light-on-surface-variant mb-1.5">Recent logins</p>
            <ul className="flex flex-col gap-1">
              {logins.map((l) => (
                <li key={l.id} className="font-body text-body-sm text-light-on-surface flex flex-wrap gap-x-2">
                  <span className="font-mono text-mono-sm text-light-on-surface-variant">{l.label}</span>
                  <span>
                    {l.actor} · {l.event}
                  </span>
                  <span className="text-light-on-surface-variant">{l.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? weakening[confirm]!.title : ''}
        description={confirm ? weakening[confirm]!.body : undefined}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
              Keep enabled
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!confirm) return
                setPolicy({ [confirm]: false })
                toast(confirm === 'requireMfa' ? 'MFA is no longer required' : 'SAML SSO is no longer enforced', 'warning')
                setConfirm(null)
              }}
            >
              Disable
            </Button>
          </>
        }
      />

      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this session?"
        description={revoking ? `${members.find((m) => m.id === revoking.memberId)?.name} is signed out of ${revoking.device} immediately and must sign in again.` : undefined}
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
                revokeSession(revoking.id)
                toast('Session revoked', 'info')
                setRevoking(null)
              }}
            >
              Revoke session
            </Button>
          </>
        }
      />
    </AdminPage>
  )
}
