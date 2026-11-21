import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { AdminHeader, AdminPage } from '../components/parts'
import { fieldClass, focusRing, labelClass, panelClass } from '../styles'
import { roleById, roles, type RoleId } from '../data'
import { inviteMember, useAdminState } from '../store'
import { useUsage } from '../usage'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Invite Users (designed: admin_invite_users). Defaults to Analyst, as designed. */
export function InvitePage() {
  usePageChrome([{ label: 'User Management', to: '/users-permissions' }, { label: 'Invite Users' }])
  const { members } = useAdminState()
  const { seats, plan } = useUsage()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleId>('analyst')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const full = seats >= plan.seats

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = email.trim().toLowerCase()
    const err = !v
      ? 'Enter a work email address.'
      : !EMAIL.test(v)
        ? 'Enter a valid email address, e.g. colleague@acme.io.'
        : members.some((m) => m.email === v)
          ? `${v} is already a member or has a pending invitation.`
          : ''
    setError(err)
    if (err) {
      emailRef.current?.focus()
      return
    }
    setSending(true)
    window.setTimeout(() => {
      inviteMember(v, role)
      toast(`Invitation sent to ${v} as ${roleById(role).label}`)
      navigate('/users-permissions')
    }, 600)
  }

  return (
    <AdminPage width="3xl">
      <AdminHeader title="Invite Team Members" description="Assign a least-privilege role before sending the workspace invitation." />
      {full && (
        <div role="alert" className="bg-warning-container text-on-warning-container rounded p-3 font-body text-body-sm">
          All {plan.seats} seats on {plan.name} are in use. Revoke a user or{' '}
          <Link to="/billing" className="underline font-label">
            change plan
          </Link>{' '}
          before inviting more people.
        </div>
      )}
      <form onSubmit={submit} noValidate className={cn(panelClass, 'p-6 flex flex-col gap-5')}>
        <div>
          <label htmlFor="invite-email" className={labelClass}>
            Work Email Address
          </label>
          <input
            ref={emailRef}
            id="invite-email"
            type="email"
            autoComplete="off"
            placeholder="colleague@acme.io"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (error) setError('')
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'invite-email-error' : undefined}
            className={cn(fieldClass, error ? 'border-error' : 'border-light-outline')}
          />
          {error && (
            <p id="invite-email-error" role="alert" className="font-body text-body-sm text-error mt-1.5">
              {error}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="invite-role" className={labelClass}>
            Assign Role
          </label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as RoleId)} className={cn(fieldClass, 'border-light-outline')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id} disabled={r.id === 'owner'}>
                {r.label} — {r.id === 'owner' ? 'Only the current Owner can transfer ownership' : r.inviteHint}
              </option>
            ))}
          </select>
          <p className="font-body text-body-sm text-light-on-surface-variant mt-1.5">
            The invitation link expires in 7 days. They must set up MFA on first sign-in.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-light-outline-variant">
          <Link to="/users-permissions" className={cn('px-4 py-2 rounded font-label text-label-lg text-light-on-surface-variant hover:bg-light-surface-container', focusRing)}>
            Cancel
          </Link>
          <Button type="submit" disabled={sending || full}>
            {sending ? 'Sending…' : 'Send Invitation'}
          </Button>
        </div>
      </form>
    </AdminPage>
  )
}
