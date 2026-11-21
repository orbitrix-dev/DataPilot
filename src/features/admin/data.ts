/**
 * Mock data for the Administration module (users, roles, permissions,
 * settings, API keys, billing). Everything is as of Friday Nov 20, 2026,
 * 14:32 UTC, like the rest of the app. People who already appear elsewhere
 * keep their names and job titles (Automate's approvers, the profile menu).
 */

/* ------------------------------------------------------------------- roles */

export type RoleId = 'owner' | 'admin' | 'manager' | 'analyst' | 'viewer'

export const roles: { id: RoleId; label: string; short: string; description: string; inviteHint: string }[] = [
  {
    id: 'owner',
    label: 'Organization Owner',
    short: 'Owner',
    description: 'Full control over billing, workspace deletion, security policies, and all module approvals.',
    inviteHint: 'Full billing, deletion, and ownership control',
  },
  {
    id: 'admin',
    label: 'Administrator',
    short: 'Admin',
    description: 'Manages Connect data sources, Trust rules, user invitations, API keys, and security settings.',
    inviteHint: 'Manage Connect sources, users, and security',
  },
  {
    id: 'manager',
    label: 'Business Manager',
    short: 'Manager',
    description: 'Reviews Insights, asks Intelligence questions, and approves or rejects Automate workflow runs.',
    inviteHint: 'Approve workflows & manage operational alerts',
  },
  {
    id: 'analyst',
    label: 'Analyst',
    short: 'Analyst',
    description: 'Creates reports, explores metrics, queries Intelligence, and drafts workflows without publishing.',
    inviteHint: 'Query Intelligence, build reports, inspect Trust',
  },
  {
    id: 'viewer',
    label: 'Viewer',
    short: 'Viewer',
    description: 'Read-only access to published dashboards and shared reports. Cannot export raw data or trigger actions.',
    inviteHint: 'Read-only access to dashboards and reports',
  },
]

export const roleById = (id: RoleId) => roles.find((r) => r.id === id)!

/* ------------------------------------------------------------- permissions */

export type CapabilityId = 'connect' | 'trust' | 'insights' | 'automate' | 'admin'

export const capabilities: { id: CapabilityId; label: string; levels: string[] }[] = [
  { id: 'connect', label: 'Connect: Add & rotate credentials', levels: ['Full', 'Read', 'None'] },
  { id: 'trust', label: 'Trust: Resolve incidents & rules', levels: ['Full', 'Edit Rules', 'View', 'None'] },
  { id: 'insights', label: 'Insights & Intelligence: Query & export', levels: ['Full', 'View Only', 'None'] },
  { id: 'automate', label: 'Automate: Approve workflow execution', levels: ['Approve', 'Draft Only', 'None'] },
  { id: 'admin', label: 'Admin: Billing & workspace deletion', levels: ['Full', 'None'] },
]

export type Matrix = Record<CapabilityId, Record<RoleId, string>>

export const seedMatrix: Matrix = {
  connect: { owner: 'Full', admin: 'Full', manager: 'Read', analyst: 'Read', viewer: 'None' },
  trust: { owner: 'Full', admin: 'Full', manager: 'View', analyst: 'Edit Rules', viewer: 'View' },
  insights: { owner: 'Full', admin: 'Full', manager: 'Full', analyst: 'Full', viewer: 'View Only' },
  automate: { owner: 'Approve', admin: 'Approve', manager: 'Approve', analyst: 'Draft Only', viewer: 'None' },
  admin: { owner: 'Full', admin: 'None', manager: 'None', analyst: 'None', viewer: 'None' },
}

/* ------------------------------------------------------------------- users */

export type MfaState = 'enabled' | 'pending'

export type Member = {
  id: string
  name: string
  email: string
  /** Job title. Automate's approver labels ("Finance Manager", "Operations Lead") are titles, not roles. */
  title: string
  role: RoleId
  /** Invited users have not accepted yet. */
  status: 'active' | 'invited'
  mfa: MfaState
  /** Time label, parsed like the rest of the app's activity ("Today, 14:20", "Nov 18, 16:05"). */
  lastActive: string
  ip?: string
}

/** The signed-in mock user (also the profile menu and Automate's `ME`). */
export const ME_ID = 'u-elena'
export const ME_NAME = 'Elena Vance'
export const ME_IP = '198.51.100.24'

export const seedMembers: Member[] = [
  { id: 'u-marcus', name: 'Marcus Chen', email: 'm.chen@acme.io', title: 'Workspace Owner', role: 'owner', status: 'active', mfa: 'enabled', lastActive: 'Today, 14:20', ip: '198.51.100.12' },
  { id: ME_ID, name: ME_NAME, email: 'e.vance@acme.io', title: 'Finance Manager', role: 'admin', status: 'active', mfa: 'enabled', lastActive: 'Today, 14:32', ip: ME_IP },
  { id: 'u-jordan', name: 'Jordan Blake', email: 'j.blake@acme.io', title: 'Data Platform Engineer', role: 'admin', status: 'active', mfa: 'enabled', lastActive: 'Today, 09:48', ip: '198.51.100.40' },
  { id: 'u-david', name: 'David Park', email: 'd.park@acme.io', title: 'Sales Director', role: 'manager', status: 'active', mfa: 'enabled', lastActive: 'Today, 12:31', ip: '198.51.100.57' },
  { id: 'u-priya', name: 'Priya Raman', email: 'p.raman@acme.io', title: 'Operations Lead', role: 'manager', status: 'active', mfa: 'enabled', lastActive: 'Today, 11:05', ip: '198.51.100.31' },
  { id: 'u-aisha', name: 'Aisha Okafor', email: 'a.okafor@acme.io', title: 'Purchasing Manager', role: 'manager', status: 'active', mfa: 'enabled', lastActive: 'Yesterday, 16:40', ip: '198.51.100.63' },
  { id: 'u-lena', name: 'Lena Fischer', email: 'l.fischer@acme.io', title: 'FP&A Analyst', role: 'analyst', status: 'active', mfa: 'enabled', lastActive: 'Today, 10:12', ip: '198.51.100.71' },
  { id: 'u-ravi', name: 'Ravi Menon', email: 'r.menon@acme.io', title: 'Sales Analyst', role: 'analyst', status: 'active', mfa: 'enabled', lastActive: 'Yesterday, 15:22', ip: '198.51.100.72' },
  { id: 'u-grace', name: 'Grace Liu', email: 'g.liu@acme.io', title: 'Inventory Analyst', role: 'analyst', status: 'active', mfa: 'enabled', lastActive: 'Yesterday, 09:30', ip: '198.51.100.73' },
  { id: 'u-owen', name: 'Owen Brooks', email: 'o.brooks@acme.io', title: 'BI Developer', role: 'analyst', status: 'active', mfa: 'enabled', lastActive: 'Nov 19, 11:02', ip: '198.51.100.74' },
  { id: 'u-nora', name: 'Nora Wilson', email: 'n.wilson@acme.io', title: 'Regional Sales Lead', role: 'viewer', status: 'active', mfa: 'enabled', lastActive: 'Nov 19, 08:47', ip: '203.0.113.9' },
  { id: 'u-samir', name: 'Samir Gupta', email: 's.gupta@acme.io', title: 'Warehouse Supervisor', role: 'viewer', status: 'active', mfa: 'pending', lastActive: 'Nov 18, 16:05', ip: '203.0.113.14' },
]

/* ---------------------------------------------------------------- security */

export type Session = { id: string; memberId: string; device: string; location: string; ip: string; signedIn: string; current?: boolean }

export const seedSessions: Session[] = [
  { id: 'sess-1', memberId: ME_ID, device: 'Chrome on macOS', location: 'San Francisco, US', ip: ME_IP, signedIn: 'Today, 08:02', current: true },
  { id: 'sess-2', memberId: 'u-marcus', device: 'Safari on macOS', location: 'San Francisco, US', ip: '198.51.100.12', signedIn: 'Today, 12:24' },
  { id: 'sess-3', memberId: 'u-david', device: 'Edge on Windows', location: 'Chicago, US', ip: '198.51.100.57', signedIn: 'Today, 12:30' },
  { id: 'sess-4', memberId: 'u-priya', device: 'Chrome on Windows', location: 'Columbus, US', ip: '198.51.100.31', signedIn: 'Today, 07:58' },
]

export type SecurityPolicy = { requireMfa: boolean; enforceSso: boolean; sessionTimeout: string }

export const sessionTimeouts = ['1 hour idle', '8 hours idle', '12 hours idle', '24 hours idle']

export const seedPolicy: SecurityPolicy = { requireMfa: true, enforceSso: true, sessionTimeout: '12 hours idle' }

export const ipAllowlist = [
  { cidr: '198.51.100.0/24', label: 'HQ office & VPN' },
  { cidr: '203.0.113.0/28', label: 'Columbus distribution center' },
]

/* ---------------------------------------------------------------- API keys */

export const scopes = [
  { id: 'insights:read', label: 'Read Insights dashboards and reports' },
  { id: 'trust:read', label: 'Read Trust incidents, freshness and quality checks' },
  { id: 'connect:read', label: 'Read Connect source status and sync history' },
  { id: 'automate:read', label: 'Read Automate workflows and run history' },
  { id: 'intelligence:query', label: 'Ask Intelligence questions' },
]

export type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; createdBy: string; created: string; lastUsed?: string; revoked?: string }

export const seedKeys: ApiKey[] = [
  { id: 'key-9f2a', name: 'BI Export Service', prefix: 'dp_live_••••9f2a', scopes: ['insights:read'], createdBy: ME_NAME, created: 'Today, 11:40', lastUsed: 'Today, 14:18' },
  { id: 'key-3c81', name: 'Trust Webhook Reader', prefix: 'dp_live_••••3c81', scopes: ['trust:read'], createdBy: 'Marcus Chen', created: 'Nov 02, 10:15', lastUsed: 'Yesterday, 22:05' },
]

/* ---------------------------------------------------------------- settings */

export type OrgSettings = { name: string; industry: string; timezone: string; retention: string }

export const industries = ['Wholesale & Distribution', 'Manufacturing', 'Logistics', 'Retail']
/** Every timestamp in DataPilot is UTC (Trust, Automate), so UTC is the default. */
export const timezones = ['UTC', 'America/Los_Angeles (UTC-8)', 'America/New_York (UTC-5)']
export const retentions = ['365 days (Enterprise)', '90 days']

export const seedOrg: OrgSettings = { name: 'Acme Global Corp', industry: 'Wholesale & Distribution', timezone: 'UTC', retention: '365 days (Enterprise)' }

export type NotificationId = 'business' | 'trust' | 'approvals'

export const notificationChannels: { id: NotificationId; label: string; channel: string; offWarning: string }[] = [
  {
    id: 'business',
    label: 'Business Risk Alerts (Revenue, Overdue, Low Stock)',
    channel: 'Email + In-App Command Center',
    offWarning: 'Business alerts will only appear on the Command Center. Nobody will be emailed.',
  },
  {
    id: 'trust',
    label: 'DataPilot Trust Incidents & Sync Failures',
    channel: 'Email + Slack (#ops-alerts)',
    offWarning: 'New Trust incidents and Connect sync failures will not be emailed or posted to #ops-alerts.',
  },
  {
    id: 'approvals',
    label: 'Automate Approval Requests',
    channel: 'Immediate Email to designated Approver role',
    offWarning: 'Approvers will not be emailed. Pending requests still wait in the Approval Center, and nothing runs without approval.',
  },
]

/* ----------------------------------------------------------------- billing */

export type PlanId = 'team' | 'growth' | 'scale'

export type Plan = { id: PlanId; name: string; price: number; seats: number; sources: number; rows: number; storageGb: number; retention: string }

export const plans: Plan[] = [
  { id: 'team', name: 'Team', price: 450, seats: 10, sources: 5, rows: 1_000_000, storageGb: 25, retention: '90-day' },
  { id: 'growth', name: 'Enterprise Growth', price: 1250, seats: 25, sources: 10, rows: 5_000_000, storageGb: 100, retention: '365-day' },
  { id: 'scale', name: 'Enterprise Scale', price: 2900, seats: 100, sources: 25, rows: 25_000_000, storageGb: 500, retention: '730-day' },
]

export const planById = (id: PlanId) => plans.find((p) => p.id === id)!

export const invoices = [
  { id: 'INV-2026-11', date: 'Nov 01, 2026', amount: 1250, status: 'Paid' },
  { id: 'INV-2026-10', date: 'Oct 01, 2026', amount: 1250, status: 'Paid' },
  { id: 'INV-2026-09', date: 'Sep 01, 2026', amount: 1250, status: 'Paid' },
  { id: 'INV-2026-08', date: 'Aug 01, 2026', amount: 1250, status: 'Paid' },
]

/** Not tracked anywhere else in the app, so kept from the design. */
export const STORAGE_USED_GB = 18.4

/* ------------------------------------------------------------------- audit */

export type AuditType = 'login' | 'permission' | 'user' | 'api-key' | 'connection' | 'workflow' | 'settings' | 'billing'

export const auditTypes: Record<AuditType, string> = {
  login: 'Login',
  permission: 'Permission Change',
  user: 'User Access',
  'api-key': 'API Key',
  connection: 'Connection Access',
  workflow: 'Workflow Approval',
  settings: 'Settings Change',
  billing: 'Billing',
}

export type AuditEvent = {
  id: string
  type: AuditType
  /** Short event name shown in the badge, e.g. "API Key Created". */
  event: string
  actor: string
  detail: string
  ip: string
  /** Time label; `at` (ms) is set for events created during the session. */
  time: string
  at?: number
  to?: string
}

/**
 * Admin-owned events before the session. Workflow approvals and credential
 * rotations are not listed here: the audit log reads them from Automate and
 * Connect so they always match those pages.
 */
export const seedAudit: AuditEvent[] = [
  { id: 'a-1', type: 'login', event: 'Login', actor: 'Marcus Chen', detail: 'SAML SSO (Okta) · Safari on macOS', ip: '198.51.100.12', time: 'Today, 12:24' },
  { id: 'a-2', type: 'api-key', event: 'API Key Created', actor: ME_NAME, detail: 'Created BI Export Service, prefix dp_live_••••9f2a (insights:read)', ip: ME_IP, time: 'Today, 11:40', to: '/settings/api-keys' },
  { id: 'a-3', type: 'login', event: 'Login', actor: ME_NAME, detail: 'SAML SSO (Okta) · Chrome on macOS', ip: ME_IP, time: 'Today, 08:02' },
  { id: 'a-4', type: 'login', event: 'Login', actor: 'Priya Raman', detail: 'SAML SSO (Okta) · Chrome on Windows', ip: '198.51.100.31', time: 'Today, 07:58' },
  { id: 'a-5', type: 'permission', event: 'Role Changed', actor: 'Marcus Chen', detail: 'Updated David Park from Analyst to Business Manager', ip: '198.51.100.12', time: 'Nov 19, 17:02', to: '/users-permissions' },
  { id: 'a-6', type: 'login', event: 'Login Blocked', actor: 'Samir Gupta', detail: 'MFA enrollment required before sign-in', ip: '203.0.113.14', time: 'Nov 19, 07:12' },
  { id: 'a-7', type: 'user', event: 'User Invited', actor: ME_NAME, detail: 'Invited s.gupta@acme.io as Viewer', ip: ME_IP, time: 'Nov 18, 15:40', to: '/users-permissions' },
  { id: 'a-8', type: 'api-key', event: 'API Key Created', actor: 'Marcus Chen', detail: 'Created Trust Webhook Reader, prefix dp_live_••••3c81 (trust:read)', ip: '198.51.100.12', time: 'Nov 02, 10:15', to: '/settings/api-keys' },
]

/** Known IPs, used for events read from other modules. */
export const ipByName: Record<string, string> = Object.fromEntries(seedMembers.filter((m) => m.ip).map((m) => [m.name, m.ip!]))
