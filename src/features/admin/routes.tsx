import type { RouteObject } from 'react-router-dom'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { AuditLogsPage } from './pages/AuditLogsPage'
import { BillingPage } from './pages/BillingPage'
import { InvitePage } from './pages/InvitePage'
import { NotificationsPage } from './pages/NotificationsPage'
import { OrgSettingsPage } from './pages/OrgSettingsPage'
import { PermissionsPage } from './pages/PermissionsPage'
import { RolesPage } from './pages/RolesPage'
import { SecurityPage } from './pages/SecurityPage'
import { UsagePage } from './pages/UsagePage'
import { UsersPage } from './pages/UsersPage'

/** Administration routes — relative children of the "/" AppShell route. Paths follow the sidebar's admin entries. */
export const adminRoutes: RouteObject[] = [
  { path: 'users-permissions', element: <UsersPage /> },
  { path: 'users-permissions/roles', element: <RolesPage /> },
  { path: 'users-permissions/permissions', element: <PermissionsPage /> },
  { path: 'users-permissions/invite', element: <InvitePage /> },
  { path: 'audit-logs', element: <AuditLogsPage /> },
  { path: 'settings', element: <OrgSettingsPage /> },
  { path: 'settings/security', element: <SecurityPage /> },
  { path: 'settings/api-keys', element: <ApiKeysPage /> },
  { path: 'settings/notifications', element: <NotificationsPage /> },
  { path: 'billing', element: <BillingPage /> },
  { path: 'billing/usage', element: <UsagePage /> },
]
