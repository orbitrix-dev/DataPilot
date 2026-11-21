import { useSyncExternalStore } from 'react'
import {
  ME_ID,
  ME_IP,
  ME_NAME,
  capabilities,
  notificationChannels,
  planById,
  roleById,
  seedAudit,
  seedKeys,
  seedMatrix,
  seedMembers,
  seedOrg,
  seedPolicy,
  seedSessions,
  type ApiKey,
  type AuditEvent,
  type CapabilityId,
  type Matrix,
  type Member,
  type NotificationId,
  type OrgSettings,
  type PlanId,
  type RoleId,
  type SecurityPolicy,
  type Session,
} from './data'

/**
 * In-memory Administration state. Every change writes an audit event, so
 * Audit Logs shows what was done during the session.
 */
export type AdminState = {
  members: Member[]
  matrix: Matrix
  sessions: Session[]
  policy: SecurityPolicy
  keys: ApiKey[]
  org: OrgSettings
  notifications: Record<NotificationId, boolean>
  plan: PlanId
  /** A plan change asked of the Owner by someone who cannot change billing. */
  planRequest?: PlanId
  /** Set when the Owner scheduled workspace deletion (cancellable). */
  deletionScheduled?: string
  audit: AuditEvent[]
}

let state: AdminState = {
  members: seedMembers,
  matrix: seedMatrix,
  sessions: seedSessions,
  policy: seedPolicy,
  keys: seedKeys,
  org: seedOrg,
  notifications: { business: true, trust: true, approvals: true },
  plan: 'growth',
  audit: seedAudit,
}

const listeners = new Set<() => void>()
function setState(next: AdminState) {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAdminState(): AdminState {
  return useSyncExternalStore(subscribe, () => state)
}

/* ----------------------------------------------------------------- helpers */

let seq = 0
function event(e: Omit<AuditEvent, 'id' | 'actor' | 'ip' | 'time' | 'at'>): AuditEvent {
  seq += 1
  return { ...e, id: `s-${seq}`, actor: ME_NAME, ip: ME_IP, time: 'Today', at: Date.now() + seq / 1000 }
}

function log(next: Partial<AdminState>, ...events: Omit<AuditEvent, 'id' | 'actor' | 'ip' | 'time' | 'at'>[]) {
  setState({ ...state, ...next, audit: [...events.map(event), ...state.audit] })
}

export const me = (s: AdminState = state) => s.members.find((m) => m.id === ME_ID)!

/** What the signed-in user's role has for a capability in the (live) permission matrix. */
export function level(s: AdminState, cap: CapabilityId): string {
  return s.matrix[cap][me(s).role]
}

/** Billing and workspace deletion follow the "Admin" row of the matrix. */
export const canManageBilling = (s: AdminState) => level(s, 'admin') === 'Full'

export const owner = (s: AdminState) => s.members.find((m) => m.role === 'owner')!

/** Members plus pending invitations: both hold a seat. */
export const seatsUsed = (s: AdminState) => s.members.length

/* ------------------------------------------------------------------- users */

export function inviteMember(email: string, role: RoleId) {
  const local = email.split('@')[0]
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  const member: Member = { id: `u-${Date.now()}`, name, email, title: 'Invitation pending', role, status: 'invited', mfa: 'pending', lastActive: 'Invited today' }
  log({ members: [...state.members, member] }, { type: 'user', event: 'User Invited', detail: `Invited ${email} as ${roleById(role).label}`, to: '/users-permissions' })
}

export function changeRole(id: string, role: RoleId) {
  const m = state.members.find((x) => x.id === id)
  if (!m || m.role === role) return
  log(
    { members: state.members.map((x) => (x.id === id ? { ...x, role } : x)) },
    { type: 'permission', event: 'Role Changed', detail: `Updated ${m.status === 'invited' ? m.email : m.name} from ${roleById(m.role).label} to ${roleById(role).label}`, to: '/users-permissions' },
  )
}

export function removeMember(id: string) {
  const m = state.members.find((x) => x.id === id)
  if (!m) return
  log(
    { members: state.members.filter((x) => x.id !== id), sessions: state.sessions.filter((x) => x.memberId !== id) },
    m.status === 'invited'
      ? { type: 'user', event: 'Invitation Cancelled', detail: `Cancelled the invitation for ${m.email}` }
      : { type: 'user', event: 'Access Revoked', detail: `Revoked ${m.name}'s access (${roleById(m.role).label}) and ended their sessions` },
  )
}

export function resendInvite(id: string) {
  const m = state.members.find((x) => x.id === id)
  if (m) log({}, { type: 'user', event: 'Invitation Resent', detail: `Resent the invitation to ${m.email}` })
}

/* ------------------------------------------------------------- permissions */

/** Saves the matrix and logs one event per changed cell. Returns the number of changes. */
export function saveMatrix(next: Matrix): number {
  const changes: Omit<AuditEvent, 'id' | 'actor' | 'ip' | 'time' | 'at'>[] = []
  for (const cap of capabilities) {
    for (const role of Object.keys(next[cap.id]) as RoleId[]) {
      const before = state.matrix[cap.id][role]
      const after = next[cap.id][role]
      if (before !== after)
        changes.push({ type: 'permission', event: 'Permission Changed', detail: `${roleById(role).label} · ${cap.label}: ${before} → ${after}`, to: '/users-permissions/permissions' })
    }
  }
  if (changes.length) log({ matrix: next }, ...changes)
  return changes.length
}

/* ---------------------------------------------------------------- security */

export function setPolicy(patch: Partial<SecurityPolicy>) {
  const [key, value] = Object.entries(patch)[0] as [keyof SecurityPolicy, SecurityPolicy[keyof SecurityPolicy]]
  const detail = {
    requireMfa: `${value ? 'Enabled' : 'Disabled'} "Require MFA for all users"`,
    enforceSso: `${value ? 'Enabled' : 'Disabled'} "Enforce SAML SSO (Okta)"`,
    sessionTimeout: `Session timeout set to ${value}`,
  }[key]
  log({ policy: { ...state.policy, ...patch } }, { type: 'settings', event: 'Security Policy Changed', detail, to: '/settings/security' })
}

export function revokeSession(id: string) {
  const s = state.sessions.find((x) => x.id === id)
  const m = s && state.members.find((x) => x.id === s.memberId)
  if (!s || !m) return
  log({ sessions: state.sessions.filter((x) => x.id !== id) }, { type: 'login', event: 'Session Revoked', detail: `Ended ${m.name}'s session (${s.device}, ${s.ip})`, to: '/settings/security' })
}

/* ---------------------------------------------------------------- API keys */

/** Creates a key and returns its secret. Only the prefix is kept. */
export function createKey(name: string, keyScopes: string[]): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  const secret = `dp_live_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
  const tail = secret.slice(-4)
  const key: ApiKey = { id: `key-${tail}-${Date.now()}`, name, prefix: `dp_live_••••${tail}`, scopes: keyScopes, createdBy: ME_NAME, created: 'Today' }
  log({ keys: [key, ...state.keys] }, { type: 'api-key', event: 'API Key Created', detail: `Created ${name}, prefix ${key.prefix} (${keyScopes.join(', ')})`, to: '/settings/api-keys' })
  return secret
}

export function revokeKey(id: string) {
  const k = state.keys.find((x) => x.id === id)
  if (!k) return
  log({ keys: state.keys.map((x) => (x.id === id ? { ...x, revoked: 'Today' } : x)) }, { type: 'api-key', event: 'API Key Revoked', detail: `Revoked ${k.name} (${k.prefix})`, to: '/settings/api-keys' })
}

/* ---------------------------------------------------------------- settings */

const orgLabels: Record<keyof OrgSettings, string> = { name: 'Organization name', industry: 'Primary industry', timezone: 'Reporting timezone', retention: 'Audit log retention' }

export function saveOrg(next: OrgSettings): number {
  const changed = (Object.keys(next) as (keyof OrgSettings)[]).filter((k) => next[k] !== state.org[k])
  if (changed.length)
    log(
      { org: next },
      ...changed.map((k) => ({ type: 'settings' as const, event: 'Organization Updated', detail: `${orgLabels[k]}: ${state.org[k]} → ${next[k]}`, to: '/settings' })),
    )
  return changed.length
}

export function setNotification(id: NotificationId, on: boolean) {
  const label = notificationChannels.find((n) => n.id === id)!.label
  log({ notifications: { ...state.notifications, [id]: on } }, { type: 'settings', event: 'Notifications Changed', detail: `${on ? 'Enabled' : 'Disabled'} ${label}`, to: '/settings/notifications' })
}

export function scheduleDeletion() {
  log({ deletionScheduled: 'Nov 27, 2026' }, { type: 'settings', event: 'Deletion Scheduled', detail: `Scheduled ${state.org.name} for permanent deletion on Nov 27, 2026` })
}

export function cancelDeletion() {
  log({ deletionScheduled: undefined }, { type: 'settings', event: 'Deletion Cancelled', detail: `Cancelled the scheduled deletion of ${state.org.name}` })
}

/* ----------------------------------------------------------------- billing */

export function changePlan(id: PlanId) {
  const from = planById(state.plan)
  const to = planById(id)
  log({ plan: id, planRequest: undefined }, { type: 'billing', event: 'Plan Changed', detail: `${from.name} → ${to.name} ($${to.price.toLocaleString('en-US')} / month, prorated)`, to: '/billing' })
}

export function requestPlan(id: PlanId) {
  log({ planRequest: id }, { type: 'billing', event: 'Plan Change Requested', detail: `Asked ${owner(state).name} to move to ${planById(id).name}`, to: '/billing' })
}
