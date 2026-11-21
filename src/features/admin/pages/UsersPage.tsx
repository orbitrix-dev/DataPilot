import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { when } from '../../command-center/activity'
import { AdminHeader, AdminPage, RoleBadge, UsersTabs } from '../components/parts'
import { dangerLinkClass, fieldClass, labelClass, linkClass, panelClass, thClass } from '../styles'
import { ME_ID, roleById, roles, type Member, type RoleId } from '../data'
import { changeRole, removeMember, resendInvite, useAdminState } from '../store'
import { useUsage } from '../usage'

/** User Management (designed: admin_user_management). */
export function UsersPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'User Management' }])
  const { members, policy } = useAdminState()
  const { seats, plan } = useUsage()
  const [params, setParams] = useSearchParams()
  const roleFilter = params.get('role') as RoleId | null
  const [editing, setEditing] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const toast = useToast()

  const shown = roleFilter ? members.filter((m) => m.role === roleFilter) : members
  const invited = members.filter((m) => m.status === 'invited').length

  return (
    <AdminPage>
      <UsersTabs />
      <AdminHeader
        title="User Management"
        description={
          <>
            {seats} of {plan.seats} seats used{invited ? ` (${invited} pending invitation${invited > 1 ? 's' : ''})` : ''}. Role changes and revocations are audited.
          </>
        }
        actions={
          <Link
            to="/users-permissions/invite"
            className="px-4 py-2 rounded bg-light-primary text-light-on-primary hover:bg-light-secondary font-label text-label-lg transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-1"
          >
            Invite Users
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by role">
        {[{ id: null, label: 'All roles' }, ...roles.map((r) => ({ id: r.id, label: r.label }))].map((r) => (
          <button
            key={r.label}
            type="button"
            aria-pressed={roleFilter === r.id}
            onClick={() => setParams(r.id ? { role: r.id } : {}, { replace: true })}
            className={cn(
              'px-2.5 py-1 rounded-full border font-label text-label-md tabular-nums transition-colors duration-state-change',
              roleFilter === r.id
                ? 'border-light-primary bg-light-primary-container text-light-on-primary-container'
                : 'border-light-outline-variant text-light-on-surface-variant hover:bg-light-surface-container',
            )}
          >
            {r.label} ({r.id ? members.filter((m) => m.role === r.id).length : members.length})
          </button>
        ))}
      </div>

      <div className={cn(panelClass, 'overflow-x-auto')}>
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-light-surface-container-low border-b border-light-outline-variant">
              <th className={thClass}>User</th>
              <th className={thClass}>Role</th>
              <th className={thClass}>MFA</th>
              <th className={thClass}>Last Active</th>
              <th className={cn(thClass, 'text-right')}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-light-outline-variant">
            {shown.map((m) => {
              const isMe = m.id === ME_ID
              const isOwner = m.role === 'owner'
              return (
                <tr key={m.id}>
                  <td className="px-4 py-3.5">
                    <p className="font-label text-label-md text-light-on-surface">
                      {m.status === 'invited' ? m.email : m.name}
                      {isMe && <span className="ml-1.5 font-body text-body-sm text-light-on-surface-variant">(you)</span>}
                    </p>
                    <p className="font-body text-body-sm text-light-on-surface-variant">{m.status === 'invited' ? 'Invitation pending' : `${m.title} · ${m.email}`}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <RoleBadge role={m.role} />
                  </td>
                  <td className="px-4 py-3.5 font-label text-label-sm">
                    {m.status === 'invited' ? (
                      <span className="text-light-on-surface-variant">On first sign-in</span>
                    ) : m.mfa === 'enabled' ? (
                      <span className="text-success">Enabled</span>
                    ) : (
                      <span className="text-warning" title={policy.requireMfa ? 'Blocked from signing in until MFA is set up' : undefined}>
                        Pending{policy.requireMfa ? ' · sign-in blocked' : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 font-body text-body-sm text-light-on-surface-variant whitespace-nowrap">
                    {isMe ? 'Active now' : when(m.lastActive).time}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-4">
                      {m.status === 'invited' ? (
                        <>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => {
                              resendInvite(m.id)
                              toast(`Invitation resent to ${m.email}`)
                            }}
                          >
                            Resend
                          </button>
                          <button type="button" className={dangerLinkClass} onClick={() => setRemoving(m)}>
                            Cancel invite
                          </button>
                        </>
                      ) : isOwner ? (
                        <Link to="/users-permissions/permissions" className={linkClass}>
                          Permissions
                        </Link>
                      ) : isMe ? (
                        <span className="font-body text-body-sm text-light-on-surface-variant">Ask the Owner to change your role</span>
                      ) : (
                        <>
                          <button type="button" className={linkClass} onClick={() => setEditing(m)}>
                            Edit Role
                          </button>
                          <button type="button" className={dangerLinkClass} onClick={() => setRemoving(m)}>
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center font-body text-body-md text-light-on-surface-variant">
                  No users have this role.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <EditRoleModal member={editing} onClose={() => setEditing(null)} />}

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing?.status === 'invited' ? 'Cancel invitation?' : `Revoke ${removing?.name}'s access?`}
        description={
          removing?.status === 'invited'
            ? `${removing.email} will no longer be able to join, and the seat is freed.`
            : 'They are signed out everywhere, lose access to every module, and their seat is freed. Their past activity stays in Audit Logs.'
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!removing) return
                removeMember(removing.id)
                toast(removing.status === 'invited' ? `Invitation for ${removing.email} cancelled` : `${removing.name}'s access revoked`, 'info')
                setRemoving(null)
              }}
            >
              {removing?.status === 'invited' ? 'Cancel invitation' : 'Revoke access'}
            </Button>
          </>
        }
      />
    </AdminPage>
  )
}

function EditRoleModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const [role, setRole] = useState<RoleId>(member.role)
  const toast = useToast()
  const name = member.status === 'invited' ? member.email : member.name
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit role: ${name}`}
      description="The new role applies at their next page load and is recorded in Audit Logs."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={role === member.role}
            onClick={() => {
              changeRole(member.id, role)
              toast(`${name} is now ${roleById(role).label}`)
              onClose()
            }}
          >
            Save role
          </Button>
        </>
      }
    >
      <label htmlFor="edit-role" className={labelClass}>
        Role
      </label>
      <select id="edit-role" value={role} onChange={(e) => setRole(e.target.value as RoleId)} className={cn(fieldClass, 'border-light-outline')}>
        {roles.map((r) => (
          <option key={r.id} value={r.id} disabled={r.id === 'owner'}>
            {r.label}
            {r.id === 'owner' ? ' (ownership transfer is done by the Owner)' : ''}
          </option>
        ))}
      </select>
      <p className="font-body text-body-sm text-light-on-surface-variant mt-2">{roleById(role).description}</p>
    </Modal>
  )
}
